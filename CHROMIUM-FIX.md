# Chromium launch fix (Docker deployment)

This build installs Chromium from Debian (`/usr/bin/chromium`) and tells Puppeteer to use that executable. It avoids errors such as `libatk-1.0.so.0 not found` from Puppeteer's downloaded browser.

**Important:** Deploy this package using its Dockerfile/container deployment method. A normal Node/buildpack deployment does not run this Dockerfile and will not install these OS packages.

After redeploy, check logs for a successful build, then test `.alive`, `.uptime`, and `.ping`. WhatsApp delivery still requires your valid session and live connection.
