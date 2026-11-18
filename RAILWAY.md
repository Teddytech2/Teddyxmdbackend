# Railway

1. Push this project to a GitHub repository (do not commit `.env`, WhatsApp session files, `database/`, or `data/`).
2. Railway: New Project -> Deploy from GitHub Repo -> select repository.
3. Railway detects `Dockerfile` and builds the container.
4. Add a Railway Volume mounted at `/app/database` for persistent SQLite/config/auth data. If this project stores auth state elsewhere, also mount `/app/session` after verifying that path in the project.
5. Set required environment variables in Railway Variables; do not upload secrets to Git.
6. Deploy and view logs. Confirm bot starts and WhatsApp connects.
