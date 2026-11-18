'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const db = require('../database');

// Resolve the very same source used by .menu. Custom SQLite image data is
// checked on every command, so .setmenuimage changes take effect immediately.
let bundledFallbackPath = null;

function getMenuImageBuffer() {
  try {
    const settings = db.getMenuImageSettings?.();
    if (settings?.custom && settings.imageData) {
      let encoded = String(settings.imageData).trim();
      if (encoded.startsWith('data:')) encoded = encoded.slice(encoded.indexOf(',') + 1);
      const buffer = Buffer.from(encoded, 'base64');
      if (buffer.length) return buffer;
    }
  } catch (_) {}

  const legacy = path.join(__dirname, '../data/custom_menu.jpg');
  try {
    if (fs.existsSync(legacy)) return fs.readFileSync(legacy);
  } catch (_) {}

  if (!bundledFallbackPath) {
    const defaults = [
      path.join(__dirname, '../assets/menu1.jpg'),
      path.join(__dirname, 'bot_image.jpg'),
      path.join(__dirname, 'menu2.jpg'),
      path.join(__dirname, 'menu3.jpg'),
      path.join(__dirname, 'menu4.jpg'),
      path.join(__dirname, 'menu5.jpg'),
    ].filter(file => { try { return fs.existsSync(file); } catch (_) { return false; } });
    if (defaults.length) bundledFallbackPath = defaults[Math.floor(Math.random() * defaults.length)];
  }
  try {
    return bundledFallbackPath ? fs.readFileSync(bundledFallbackPath) : null;
  } catch (_) {
    return null;
  }
}

function detectPlatform() {
  if (process.env.JHP_PLATFORM) return 'J.H.P';
  if (process.env.DYNO) return 'Heroku';
  if (process.env.RENDER || process.env.RENDER_SERVICE_ID) return 'Render';
  if (process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID) return 'Railway';
  if (process.env.REPL_ID || process.env.REPL_SLUG) return 'Replit';
  if (process.env.P_SERVER_UUID) return 'Panel / VPS';
  if (process.env.VERCEL) return 'Vercel';
  if (process.env.FLY_APP_NAME) return 'Fly.io';
  if (process.env.PREFIX?.toLowerCase().includes('termux')) return 'Termux';
  return `${os.platform()} (self-hosted / VPS)`;
}

function formatDuration(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${d}d ${h}h ${m}m ${sec}s`;
}

function formatBytes(bytes) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

function timestamp() {
  const zone = process.env.TZ || 'Africa/Nairobi';
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: zone, dateStyle: 'medium', timeStyle: 'medium', hour12: true,
    }).format(new Date()) + ` (${zone})`;
  } catch (_) {
    return new Date().toISOString();
  }
}

function cpuSnapshot() {
  return os.cpus().map(cpu => ({ ...cpu.times }));
}

function cpuPercent(before, after) {
  if (!before.length || before.length !== after.length) return null;
  let idle = 0, total = 0;
  for (let i = 0; i < before.length; i++) {
    const old = before[i], now = after[i];
    const oldTotal = Object.values(old).reduce((a, b) => a + b, 0);
    const newTotal = Object.values(now).reduce((a, b) => a + b, 0);
    total += newTotal - oldTotal;
    idle += now.idle - old.idle;
  }
  return total > 0 ? Math.max(0, Math.min(100, (1 - idle / total) * 100)) : null;
}

async function getSystemReport() {
  const before = cpuSnapshot();
  await new Promise(resolve => setTimeout(resolve, 120));
  const cpu = cpuPercent(before, cpuSnapshot());
  const mem = process.memoryUsage();
  const total = os.totalmem();
  const free = os.freemem();
  return {
    uptime: formatDuration(process.uptime()),
    uptimeSeconds: process.uptime(),
    platform: detectPlatform(),
    node: process.version,
    os: `${os.type()} ${os.release()} (${os.arch()})`,
    serverRamUsed: total - free,
    serverRamTotal: total,
    botRamUsed: mem.rss,
    botHeapUsed: mem.heapUsed,
    botHeapTotal: mem.heapTotal,
    cpu: cpu === null ? 'Unavailable' : `${cpu.toFixed(1)}%`,
    timestamp: timestamp(),
  };
}

function buildCard(title, report, alive = false) {
  const line = '━━━━━━━━━━━━━━━━━━━━';
  const rows = [
    '⚡ *TEDDY-XMD SYSTEM MONITOR*',
    line,
    `🟢 *STATUS:* ONLINE`,
    `⏱️ *UPTIME:* ${report.uptime}`,
  ];
  if (alive) rows.push('✅ *BOT IS ALIVE*', '_I am online, connected and responding to commands._');
  else rows.push('📊 *BOT UPTIME REPORT*');
  rows.push(
    line,
    `📅 *DATE & TIME:* ${report.timestamp}`,
    `☁️ *PLATFORM:* ${report.platform}`,
    `🟩 *NODE.JS:* ${report.node}`,
    `🐧 *OS:* ${report.os}`,
    line,
    `🖥️ *SERVER RAM:* ${formatBytes(report.serverRamUsed)} / ${formatBytes(report.serverRamTotal)}`,
    `🤖 *BOT RAM (RSS):* ${formatBytes(report.botRamUsed)}`,
    `🧠 *BOT HEAP:* ${formatBytes(report.botHeapUsed)} / ${formatBytes(report.botHeapTotal)}`,
    `⚙️ *CPU USAGE:* ${report.cpu}`,
    line,
    '*TEDDY-XMD • ALWAYS ONLINE • ALWAYS READY*'
  );
  return rows.join('\n');
}

async function sendStatus(sock, extra, report, alive) {
  const caption = buildCard(alive ? 'ALIVE' : 'UPTIME', report, alive);
  let image = null;
  try { image = getMenuImageBuffer(); } catch (_) {}
  if (image?.length) {
    try {
      await sock.sendMessage(extra.from, { image, caption, mimetype: 'image/jpeg' });
      return;
    } catch (error) {
      console.warn('[status-command] Menu image send failed; using text fallback:', error.message);
    }
  }
  await extra.reply(caption);
}

module.exports = {
  getMenuImageBuffer, detectPlatform, formatDuration, formatBytes,
  getSystemReport, buildCard, sendStatus,
};
