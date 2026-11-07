# TEDDY-XMD persistent settings storage

TEDDY-XMD keeps its synchronous runtime database in SQLite and uses PostgreSQL as its durable remote backup/restore store. This preserves compatibility with existing commands while allowing settings to survive a host filesystem reset, provided the PostgreSQL service remains available.

## Heroku

The Heroku `app.json` now requests the `heroku-postgresql:essential-0` add-on. When Heroku provisions the add-on it injects `DATABASE_URL`; the bot detects that variable, creates/updates its PostgreSQL schema, restores missing settings, and mirrors supported changes. If the app already exists, add the add-on to that app in Heroku (or provision it through the Heroku dashboard/CLI). Existing apps are not modified just by uploading this ZIP.

## Railway

Create or attach a Railway PostgreSQL service to the bot service and expose its connection URL to the bot as `DATABASE_URL` (Railway commonly provides a `DATABASE_URL` reference from the PostgreSQL service). The bot then performs schema setup and sync automatically. A repository deployment cannot create a Railway database in an existing project unless the Railway project owner provisions/authorizes that service.

## VPS / Pterodactyl / other panels

The bot automatically connects when the panel supplies `DATABASE_URL`. If the panel does not provide a managed PostgreSQL service, an administrator must create/attach one (or run PostgreSQL in Docker) and set `DATABASE_URL`. Pterodactyl eggs and ordinary VPS deployments do not have a universal API for creating databases, so the bot cannot safely create one without panel-specific credentials and permissions.

## Important behaviour

- Do not point multiple independent bot installations at the same database identity. Set a unique `TEDDY_BOT_ID` per installation, or use the supported PN/session identity mechanism.
- PostgreSQL is the remote recovery/mirror layer; SQLite remains the live synchronous store for this release.
- If PostgreSQL is unavailable, the bot continues with local SQLite and queues supported remote mirror operations for retry. Local-only hosting storage can still be lost if the host wipes it before the remote service becomes available.
- Keep a separate backup of your PostgreSQL database. Never publish `DATABASE_URL` or share it in support chats.
