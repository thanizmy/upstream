# Upstream

Demo situation brief for international ministry staff. Public RSS/Atom feeds are turned into country-level urgency
updates and a personal prayer space. Static site on Cloudflare (Workers static assets); data refreshed by GitHub Actions.

- `pipeline/run.mjs` fetches feeds, tags countries, classifies severity (1-5), clusters reports into unique events and scores
  countries (urgency-weighted load, compared with each country's own history once about 3 weeks exist).
- `pipeline/feeds.json` is the vetted feed list; rebuild it with `node pipeline/checkfeeds.mjs`.
- `public/` is the site; `public/data/` is generated.
- `.github/workflows/refresh.yml` refreshes every 3 hours and deploys. Needs repo secrets `CLOUDFLARE_API_TOKEN`
  (Workers edit) and `CLOUDFLARE_ACCOUNT_ID`.

Local: `npm ci && node pipeline/run.mjs && npx wrangler deploy`

## Feed registry rule

A feed enters the registry only if `node pipeline/checkfeeds.mjs` passes it: the body parses as RSS, Atom or RDF (an HTML page that returns HTTP 200 fails), it has at least 3 items that each carry a title and an http(s) link, and its **newest** dated item was published within the last 45 days (undated items do not count, future dates are ignored). The same rule is applied on every refresh in `pipeline/run.mjs`: a feed that has gone quiet or stopped parsing is reported as not live in `data/health.json`, and its items are not ingested.

## Scoring model v2 (checkpoint of the previous model: tag `scoring-v1`)

- **Event severity** is impact-based and the same for every country: 3 = a few casualties or a notable disruption, 4 = 10 or more dead or a declared emergency, 5 = 100 or more dead or a mass atrocity. "Killed" with no number counts as 3. A severity 4 or 5 event reported by one outlet counts as 3 until a second outlet confirms it.
- **Score** `S = 8(1+ln n3) + 30(1+ln n4) + 100(1+ln n5)`, from unique events of severity 3 to 5. The severity-3 part is capped at 25, so minor incidents alone reach Elevated but never High. One outlet's solo severity-3 reports are capped at 5 per country.
- **Weekly level** from fixed thresholds on S: Quiet (no severity 3+ events), Routine < 10, Elevated < 30, High < 100, Critical >= 100. Earlier weeks fade out (half of last week, a quarter of the week before; the highest counts), so a country eases down after serious events stop.
- **Monthly level**: the sum of four weekly scores against 4x the thresholds. The peak week is shown beside it.
- **Surge** (after about three weeks of history): this week against the country's own median and spread of recent weeks, blended toward the world typical value while its own history is short. z >= 2.5 lifts the level one step; it never lowers one. Shown in the country report.
- **US** is counted only when an event happens there (a state or city is named, or "in the United States"). Being named as an actor does not place an event in the US.
- Stored history is re-scored automatically whenever the model version changes.
