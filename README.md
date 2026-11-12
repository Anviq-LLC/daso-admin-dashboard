# DaSO Admin Dashboard

Internal dashboard for revenue, staff, subcontractor and cost reporting. It reads the Aufmass and
Montageplanung data directly (read-only), keeps its own facts, costs and BWA/SuSa imports, and shows
day, month and year views with forecasts.

## Stack

- Cloudflare Worker (TypeScript) with React and Vite for the UI
- D1 for its own data (`DB`), read-only bindings to the Aufmass (`AUFMASS`) and Montageplanung (`PLAN`) databases
- R2 bucket `BUCKET` for the original BWA/SuSa files (optional binding)
- Cloudflare Access for sign-in, roles in the `roles` table (`gf`, `buchhaltung`, `viewer`)
- A second Worker, `daso-data-api`, serves fixed read-only endpoints for outside tools behind a Bearer key

## Run locally

```
pnpm install
pnpm test
pnpm build
printf 'DASO_DEV_IDENTITY=1\n' > .dev.vars
pnpm exec wrangler d1 migrations apply DB --local
pnpm dev
```

The source databases need the Aufmass `records` table and the Montageplanung `resources`, `assignments`
and `punches` tables locally. `DASO_DEV_IDENTITY` only works while `CF_ACCESS_AUD` is unset.

## Configuration

| Name | Purpose |
| --- | --- |
| `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD` | Cloudflare Access verification |
| `DASO_OWNER_EMAIL` | Always has the `gf` role |
| `API_KEY_HASH` | SHA-256 hex of the data API key (data API Worker only) |

Rules (approval mode, daily target, employer surcharge, holidays) are edited in the app under Einstellungen.
Holidays are Rheinland-Pfalz. The approval mode is `saved` (a finished report counts) or `customer`
(customer approval required, the older Aufmass flow).

## Data refresh

A cron trigger every 15 minutes recomputes the months touched by changed source records and the
running month, and once a night all known months. Past values that change are written to `change_log`.
The trigger and the R2 binding are configured in `wrangler.jsonc`.

The Aufmass calculation code is vendored with `pnpm sync:aufmass` so both tools compute the same numbers.

## Deploy

```
pnpm exec wrangler d1 migrations apply DB --remote
pnpm build && pnpm exec wrangler deploy
pnpm exec wrangler deploy -c wrangler.api.jsonc
printf %s "<key>" | sha256sum    # store the hash as the API_KEY_HASH secret of daso-data-api
```

Protect the dashboard Worker with a Cloudflare Access application. The data API Worker uses its own Bearer key.
