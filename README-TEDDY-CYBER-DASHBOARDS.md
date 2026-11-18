# TEDDY-XMD Cyber Dashboards Upgrade

## Features
- `.alive`, `.uptime`, and `.ping` send rendered PNG dashboards in the TEDDY-XMD neon cyber style.
- A shared HTML/CSS renderer (`utils/cyberDashboard.js`) is used for all three commands and the startup CONNECTED notification.
- Dashboard artwork uses the same menu image resolver used by `.menu` (`utils/statusCard.js`), including custom SQLite menu image data.
- Metrics are collected when invoked: process uptime, system RAM, process RSS/heap, sampled CPU usage, OS/platform, Node.js, CPU load, and current server time.
- `.ping` reports local handler timing and message timestamp age separately. The post-send text measures local send-call duration; it is **not** a WhatsApp network round-trip measurement.
- Fresh database defaults remain `autoStatusView: true` and `antideleteMode: private`. Existing persisted settings are not overwritten.
- The hardcoded Telegram token was removed from the source; set `TELEGRAM_TOKEN` in the deployment environment if Telegram features are required.

## Installation
1. Use Node.js 20.x and npm 10+ (the package engine constraint).
2. Copy `.env.example` to `.env` for local setup; fill only the values you actually use.
3. Run `npm install` in the project directory. Puppeteer installs its compatible browser by default.
4. If browser installation is skipped, install a supported Chrome/Chromium and set `PUPPETEER_EXECUTABLE_PATH` to its executable path.
5. Deploy with the project's normal environment and auth/session configuration. Do not place credentials in source control.

### Rendering requirements
The renderer uses Puppeteer in headless mode with `--no-sandbox` for container-compatible rendering. A working Chromium/Chrome browser is required. Dashboard image generation fails gracefully and the CONNECTED notification falls back to text if rendering is unavailable. Temporary browser contexts are closed after each render; no HTML/image files or recurring timers are created.

## Commands
- `.alive` — current bot online state and system dashboard.
- `.uptime` — detailed uptime and system dashboard, including estimated process start time.
- `.ping` — dashboard with local handler timing, message timestamp age, and a text note reporting local image-send call duration. WhatsApp network RTT is not available through this measurement.
- `.autostatusview on|off|get` — existing setting command remains available.
- `.antidelete private|chat|off` — existing anti-delete mode command remains available.

## Menu image
The dashboard resolves the menu image through the same function used by `.menu`. A custom image set through `.setmenuimage` is stored in SQLite and is used on subsequent dashboard requests. Bundled fallback behavior remains the menu's existing behavior.

## Verification caveats
Local syntax checks and tests can be run with `npm test`. WhatsApp delivery is not asserted unless run with a valid session and active connection. No credentials, auth/session files, `node_modules`, or cache folders should be included in the distributable archive.
