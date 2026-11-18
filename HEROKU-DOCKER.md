# Heroku Docker/container deploy

Docker is the portable route for Chromium dependencies. This project includes a Dockerfile.

1. Install Heroku CLI and Docker.
2. Log in: `heroku login` and `heroku container:login`.
3. Create or select an app: `heroku create APP_NAME` or use your existing app.
4. From project root: `heroku container:push worker -a APP_NAME`.
5. Release: `heroku container:release worker -a APP_NAME`.
6. Scale: `heroku ps:scale worker=1 -a APP_NAME`.
7. Logs: `heroku logs --tail -a APP_NAME`.

If using a Heroku Fir app, verify its container deployment support and process type settings in the dashboard/CLI. Avoid the Cedar-only Apt buildpack path for Fir.

Persistent session/database state is required. Configure an appropriate external database/storage or supported persistent storage strategy; ephemeral dyno filesystem is not durable across restarts.
