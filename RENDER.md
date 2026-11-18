# Render

Deploy as a **Background Worker**, not a web service: New -> Background Worker -> connect repository -> Runtime Docker / Dockerfile. Use `Dockerfile` at repo root. Add a persistent disk if supported for the worker, mounted at `/app/database`; also persist `/app/session` and `/app/data` if the bot writes runtime state there. Set environment variables in Render's Environment page. Deploy and inspect logs. A worker needs an appropriate paid plan and persistent storage for durable session state.
