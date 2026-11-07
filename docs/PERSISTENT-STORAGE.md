# TEDDY-XMD persistent settings storage

TEDDY-XMD keeps its existing SQLite runtime database and uses PostgreSQL as the remote persistence and recovery layer. At startup it connects to PostgreSQL, creates/validates the schema, restores missing settings, and queues a backfill of the current durable settings. This preserves the existing database API and avoids changing WhatsApp pairing/session code.

## Environment variables

Set one connection variable supplied by your host: `DATABASE_URL`, `POSTGRESQL_URL`, or `POSTGRES_URL`. The preferred name on Heroku and Railway is `DATABASE_URL`. Set `TEDDY_BOT_ID` only when you need a stable custom namespace; otherwise the adapter derives a namespace from the configured bot/owner number.

## Heroku

The included `app.json` requests `heroku-postgresql:essential-0` when creating a new app through an app.json deployment flow. For an already-existing Heroku app, Heroku does not apply add-ons from an updated ZIP: provision Heroku Postgres once in the app's Resources tab (or with `heroku addons:create heroku-postgresql:essential-0 -a APP_NAME`). Heroku then supplies `DATABASE_URL`.

## Railway

Add a PostgreSQL service to the Railway project and reference its connection URL in the bot service as `DATABASE_URL` (Railway commonly exposes this through a variable reference such as `${{Postgres.DATABASE_URL}}`, using the actual service name). A source ZIP cannot create a Railway service inside an already-existing project because that requires project-level authorization.

## VPS / Pterodactyl / other panels

Use a PostgreSQL service provided by the host or panel and set `DATABASE_URL` in the server's environment. Some Pterodactyl panels let the server owner allocate a database; others require an administrator to create it. The bot cannot bypass those panel permissions.

## Startup verification

A successful connection is reported as `PostgreSQL: connected` in the startup report and `[PG] Connected` in the logs. If it reports `not configured`, no connection URL was supplied. If it reports `unavailable`, check the connection URL and provider status. SQLite remains active if PostgreSQL is unavailable, but that host-local data alone is not durable on ephemeral filesystems.

## Important notes

- Existing local settings are not deleted by PostgreSQL initialization.
- PostgreSQL restores only missing settings; it does not overwrite valid local values during startup.
- The PostgreSQL adapter is a mirror/recovery layer, not a replacement for the SQLite runtime API.
- WhatsApp pairing and authentication code is not modified by this storage update.
- Do not share `DATABASE_URL`; it contains database credentials.
