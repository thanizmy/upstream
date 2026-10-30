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
