# VPS (Docker)

Install Docker Engine and Docker Compose plugin on your Linux VPS, upload/clone this project, and from project root run:

```bash
docker compose up -d --build
docker compose logs -f teddy-xmd
```

The compose file persists `database/`, `data/`, and `session/` as local folders. Keep them backed up and private. To update, pull/copy the new source then run `docker compose up -d --build`. Ensure the host has enough RAM for Node.js plus headless Chromium rendering.
