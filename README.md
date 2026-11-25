# Upstream

A situation brief for international ministry staff. Public news and humanitarian RSS/Atom feeds are turned into country-level urgency scores, a ranked list of urgent events, and a personal prayer space. No AI or translation service is used.

Runs on Cloudflare: a Worker serves the account API and the static site; GitHub Actions refreshes the data.

## Architecture

| Path | Role |
| --- | --- |
| `public/` | Static front end (no build step). `public/data/` is generated and git-ignored. |
| `worker/index.js` | Worker: `/api/*` account endpoints; all other requests go to static assets. |
| `worker/migrations/` | D1 schema for accounts, sessions and login throttling. |
| `pipeline/` | Data pipeline: fetch feeds, tag countries, classify, cluster, score. |
| `.github/workflows/refresh.yml` | Rebuilds data every 3 hours and on every push to `main`, then deploys. |

## Quick start

Requires Node.js 20+.

```sh
npm ci
node pipeline/run.mjs                                   # build public/data/
npx wrangler d1 migrations apply upstream-auth --local  # once
npx wrangler dev                                        # http://localhost:8787
```

Use `wrangler dev`, not a plain static server: without the Worker there is no `/api`, and sign-up and login fail with "could not reach the server".

## Deploy

One-time setup:

1. `npx wrangler d1 create upstream-auth`, then put the printed `database_id` in `wrangler.jsonc`.
2. `npx wrangler d1 migrations apply upstream-auth --remote`

Then `npx wrangler deploy`, or push to `main`. The workflow needs repository secrets `CLOUDFLARE_API_TOKEN` (Workers edit) and `CLOUDFLARE_ACCOUNT_ID`. Run new migrations with step 2 before deploying code that needs them; the workflow does not apply them.

## Accounts

| Endpoint | Purpose |
| --- | --- |
| `POST /api/signup` | `{username, email, password}`. Creates the account and signs in. |
| `POST /api/login` | `{username or email, password}`. |
| `POST /api/logout` | Ends the session. |
| `GET /api/me` | Returns `{user}` or `{user: null}`. |

- Username: 3–20 letters, numbers, `.`, `-`, `_`. Password: 8–20 characters with at least 1 number and 1 special character. Both are checked in the browser and on the server.
- Passwords are salted and hashed with PBKDF2-SHA-256 (100,000 iterations, the Workers maximum). Only the hash is stored.
- Sessions are random 256-bit tokens, stored hashed, sent as an `HttpOnly; Secure; SameSite=Lax` cookie for 30 days.
- Login is limited to 5 failures per username and IP per 15 minutes. POSTs from other origins are refused.
- Not implemented: password reset and email verification.
- A user's followed countries and prayer list are stored in their browser (per account), not on the server.

## Data and scoring (model v2)

The previous model is tagged `scoring-v1`. Stored history is re-scored automatically when the model version changes.

- **Feeds.** Two vetted lists, both read on each refresh: `pipeline/feeds.world.json` (international and national outlets, mostly English) and `pipeline/feeds.local.json` (outlets tied to one country, many in the local language). Re-vet them in place with `node pipeline/checkfeeds.mjs`. `node pipeline/discover.mjs` finds more local outlets (GDELT's domains-by-country file, awesome-rss-feeds, ournet/news-sources, and with `WIKIDATA=1` Wikidata) and adds the ones that pass to `feeds.local.json`, keeping what is there and capping each country at `CAP` (default 60). A feed qualifies only if its body parses as RSS, Atom or RDF, it has at least 3 items with a title and an http(s) link, and its newest dated item is under 45 days old. The same rule runs on every refresh. A feed that fails is reported as not live in `data/health.json` and its items are skipped.
- **Event severity** (same for every country): 3 = a few casualties or a notable disruption; 4 = 10 or more dead or a declared emergency; 5 = 100 or more dead or a mass atrocity. "Killed" with no number counts as 3. A severity 4–5 event from one outlet counts as 3 until a second outlet confirms it.
- **Score** `S = 8(1+ln n3) + 30(1+ln n4) + 100(1+ln n5)` over unique events of severity 3–5. The severity-3 part is capped at 25, so minor incidents reach Elevated but never High. One outlet's solo severity-3 reports are capped at 5 per country.
- **Weekly level** from fixed thresholds on S: Quiet (no severity 3+ events), Routine < 10, Elevated < 30, High < 100, Critical ≥ 100. Earlier weeks fade (half of last week, a quarter of the week before; the highest counts), so a country eases down after serious events stop.
- **Monthly level**: the sum of four weekly scores against 4× the thresholds; the peak week is shown beside it.
- **Surge** (after about three weeks of history): this week against the country's own median and spread, blended toward the world typical value while history is short. z ≥ 2.5 lifts the level one step and never lowers one.
- **United States** is counted only when an event happens there (a state or city is named, or "in the United States"). Being named as an actor does not count.

## Translation

Local-language headlines are shown as written. Their link opens a page machine-translated by Google Translate, opened by the reader, with an Original link beside it. `pipeline/translate.mjs` is a stub that makes no network calls.

## Contributing

Headlines, images and links belong to their publishers; the site links out and does not reproduce articles. Report issues at https://github.com/thanizmy/upstream/issues.

## Headline classifier (shadow mode)

A small model learns to tell a real incident from a figure of speech, a past event, an analysis piece or good news. It combines three signals in one final model: TF-IDF + logistic regression (words it has seen; plain JavaScript), multilingual sentence embeddings (`multilingual-e5-small`, run locally; carries meaning across languages) and the rule severity. No API or AI service is called. `pipeline/model.json` holds all the weights (about 45 KB); the embedding model (about 100 MB) is downloaded on first use to `.cache/models` and cached by the workflow.

**Where it acts.** On every refresh `run.mjs` scores the headlines the rules call serious (severity 3 or more), in every language, and stores the chance of "real incident" as `mp`. It scores a headline once per trained model, not on every refresh. In **shadow** mode (`meta.mode`) that is all: no severity or country score changes. In **gate** mode a serious headline under `meta.gate` drops to severity 2 and the original is kept (`sg`); protests, unrest and political crises are never demoted. Set `meta.mode` back to `shadow` to undo it. A headline with a person's override in `overrides.json` is never scored or demoted. If the embedding model cannot be downloaded or takes over 15 minutes, the refresh still succeeds, nothing is scored and no score changes (at most 8,000 headlines are scored per refresh, newest first). The model only answers incident or not; the rules still decide whether it is a 3, 4 or 5.

**Growing the data (the loop).**

1. Every refresh adds new headlines in all languages to a pool (`.cache/label-pool.json`, kept in the Actions cache, capped at 6,000). `#review` shows a batch of 300: 60% English and 40% other languages, with the headlines the classifier is least sure about first. `data/label-pool.csv` has the whole pool as a spreadsheet; both files are published with the site, so they hold only headlines that are already public (columns `lang`, `label` = 1 real incident / 0 not, and optional `human_severity` 1-5).
2. Label them on `#review` (optionally pick a severity) and press **Copy labels**, then save the JSON and run `npm run import-labels -- file.json` (a CSV works too). Labels merge into `pipeline/ml/labels.json`, `severity.json` and, for non-English headlines, `lang.json`. Commit them: these three files are the training data.
3. `npm run train` fits the models and writes `pipeline/model.json`. A stable 20% of the labels (`split.mjs`) is the **gold set**: never trained on and never used to choose settings. The final model learns from out-of-fold predictions, so it never sees a score from a model that trained on that headline.
4. `npm run eval` scores the rules, the classifier alone and the rules with the gate on the gold set, overall and for English / non-English: false alarms, missed incidents, and real incidents the gate would wrongly demote.
5. When the eval shows the gate removing false alarms without demoting real incidents, and the shadow scores agree on live data, set `meta.mode` to `gate`.
6. `npm run dataset` shows how much labelled data there is, per language, and whether it is enough to fine-tune a multilingual model (about 3,000 labels, 1,200+ non-English, 5+ languages with 100+ each; rules of thumb). `npm run dataset -- --write` exports `pipeline/ml/finetune.jsonl`. Use human labels only: never add the classifier's own predictions as labels, or it learns its own mistakes and the gold set stops meaning anything.

Public datasets that could add labelled headlines later (check each licence before use): MN-DS (Zenodo, 10.5281/zenodo.7394850), HUMVI (dataminr-ai/humvi-dataset), Eventist, CEHA, HUMSET. GDELT is free to download but needs its own theme filtering.
