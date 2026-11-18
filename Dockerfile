# Cross-platform runtime: Heroku Container Registry, Render, Railway, VPS/Docker
FROM node:20-bookworm-slim

ENV NODE_ENV=production \
    PUPPETEER_CACHE_DIR=/root/.cache/puppeteer \
    PUPPETEER_SKIP_DOWNLOAD=false

# Chrome/Puppeteer runtime libraries plus build tools for native npm modules
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates fonts-liberation fonts-noto-color-emoji \
    libasound2 libatk1.0-0 libatk-bridge2.0-0 libatspi2.0-0 \
    libc6 libcairo2 libcups2 libdbus-1-3 libdrm2 libgbm1 \
    libglib2.0-0 libgtk-3-0 libnss3 libpango-1.0-0 \
    libx11-6 libx11-xcb1 libxcb1 libxcomposite1 libxdamage1 \
    libxext6 libxfixes3 libxrandr2 libxrender1 libxshmfence1 \
    libxss1 libxtst6 wget xdg-utils python3 make g++ && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY . .

# Persistent runtime folders (mount volumes here on hosts that support them)
RUN mkdir -p /app/database /app/data /app/session

# Run as non-root; Puppeteer uses --no-sandbox in the dashboard renderer.
USER node
ENV HOME=/home/node
EXPOSE 3000
CMD ["npm", "start"]
