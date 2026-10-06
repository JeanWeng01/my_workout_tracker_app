# Deploying Bulletproof to Railway

One Railway service runs the whole app: it serves the built client and the `/api` routes from the same
origin, and talks to a Postgres in the same project over Railway's private network. All training logic runs
on the phone; the server is dumb storage.

## What you need

| Variable | Where it comes from |
|---|---|
| `DATABASE_URL` | Reference the Postgres service's private URL: `${{Postgres.DATABASE_URL}}` |
| `SYNC_TOKEN` | A long random secret you generate (below). At least 24 characters, or the server refuses to start. |
| `PORT` | Provided by Railway. The server listens on it. |

Generate a token (any machine with Node):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Keep it somewhere safe (password manager). You type it into the app once per phone.

## Checklist

1. **Project.** Use the Railway project that holds this repo's service. Add a Postgres to it
   (`+ New` → `Database` → `PostgreSQL`), or from a terminal: `railway add --database postgres`.
2. **Service.** The service is deployed from the GitHub repo (`JeanWeng01/my_workout_tracker_app`). Build and
   start commands come from `railway.json` in the repo root, so there is nothing to type in the dashboard:
   - build: `npm run build` (builds the client, then compiles the server)
   - start: `npm start`
   - health check: `GET /api/health`
3. **Variables** on the service:
   - `DATABASE_URL` = `${{Postgres.DATABASE_URL}}` (the private-network URL, not the public one)
   - `SYNC_TOKEN` = the token you generated
4. **Deploy.** Deploying runs the migrations automatically, once, before the server starts listening. They
   create the schema `bulletproof` and its three tables (`settings`, `sessions`, `decisions`) plus a
   `schema_migrations` bookkeeping table. **Nothing outside the `bulletproof` schema is created, altered or
   dropped.** The migration runner refuses any SQL that isn't qualified with `bulletproof.` (see
   `server/src/migrate.ts` and `server/migrations/`).
5. **Public domain.** Service → Settings → Networking → `Generate Domain`. Open
   `https://<your-domain>/api/health`. It should answer `{"ok":true}`.
6. **Phone.** Follow `INSTALL.md`.

## Using the CLI instead

```bash
railway link --project <project>          # once
railway add --database postgres           # if the project has no database yet
railway variables --set 'DATABASE_URL=${{Postgres.DATABASE_URL}}' --set "SYNC_TOKEN=<token>"
git push                                   # Railway builds and deploys from GitHub
railway logs                               # look for "[migrate] applied 1" then "Server listening"
```

## Sharing a database with another project

This app is safe to run in a database other projects use: everything lives in the `bulletproof` schema, and
the runner will not run SQL that touches other schemas. If you ever want to remove the app's data:

```sql
DROP SCHEMA bulletproof CASCADE;   -- manual, deliberate, and only touches this app
```

If the Postgres is in a *different* Railway project, the private URL is not reachable (private networking is
per project). Either deploy this service into the database's project, or add a Postgres next to this service.

## Updating

Push to `main`. Railway rebuilds and redeploys; new migrations (files in `server/migrations/`) run
automatically on start and are recorded so they never run twice. Phones pick up the new client the next time
they open the app. Workouts in progress are saved on every tap, so an update never loses a draft.

## Backups

Postgres sync is the primary backup. Settings → "Download backup (JSON)" is a second, independent copy you
can keep anywhere, and "Restore from backup" validates a file before it changes anything.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Deploy fails right after start: `SYNC_TOKEN is not set` / `too short` | Variable missing, or under 24 characters |
| `DATABASE_URL is not set` | Variable missing; check it references the Postgres service |
| `ECONNREFUSED` / `ENOTFOUND` on the database | Used the public URL from another project, or the Postgres service isn't in this project |
| App says "Sync token rejected" | Token typed differently than the `SYNC_TOKEN` variable (check for trailing spaces) |
| App says "Not synced: offline" | No signal. Nothing is lost; it catches up on its own |
| "Install app" never appears | Must be opened over `https://` (the Railway domain), not `http://` |

## Running it locally

```bash
npm install
npm test                  # engine tests, then server tests (starts a throwaway real Postgres)
npm run build
node e2e/stack.mjs        # local stack on http://localhost:3100 (embedded Postgres, token printed in the file)
node e2e/smoke.mjs        # browser checks; also e2e/phase5.mjs, e2e/sync.mjs, e2e/pwa.mjs
```
