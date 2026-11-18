'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs');
const { getMenuImageBuffer, getSystemReport, formatDuration, formatBytes } = require('./statusCard');

let puppeteer = null;
try { puppeteer = require('puppeteer'); } catch (_) { /* optional until installed */ }

function escapeHtml(value) {
  return String(value ?? 'Unavailable').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function getStats(report) {
  const total = os.totalmem();
  const free = os.freemem();
  const used = total - free;
  const cpus = os.cpus() || [];
  const load = os.loadavg?.() || [];
  return {
    cpu: report.cpu || 'Unavailable',
    load: load.length ? load.map(n => n.toFixed(2)).join(' / ') : 'Unavailable',
    systemRam: `${formatBytes(used)} / ${formatBytes(total)}`,
    ramFree: formatBytes(free),
    botRam: formatBytes(process.memoryUsage().rss),
    botHeap: `${formatBytes(process.memoryUsage().heapUsed)} / ${formatBytes(process.memoryUsage().heapTotal)}`,
    node: process.version,
    platform: `${os.type()} ${os.release()} (${os.arch()})`,
    hostPlatform: report.platform || 'Unavailable',
    uptime: formatDuration(process.uptime()),
    uptimeSeconds: Math.floor(process.uptime()),
    startTime: new Date(Date.now() - process.uptime() * 1000).toLocaleString(),
    time: report.timestamp || new Date().toLocaleString(),
    cpuCount: cpus.length || 'Unavailable',
  };
}

function dashboardHtml({ type = 'alive', title, status = 'ONLINE', detail = '', stats, menuImage }) {
  const imageMime = menuImage ? (menuImage[0] === 0x89 && menuImage[1] === 0x50 ? 'image/png' : menuImage[0] === 0xff && menuImage[1] === 0xd8 ? 'image/jpeg' : menuImage[0] === 0x52 && menuImage[1] === 0x49 ? 'image/webp' : 'image/jpeg') : '';
  const imageSrc = menuImage ? `data:${imageMime};base64,${menuImage.toString('base64')}` : '';
  const metric = (label, value, icon, color = 'cyan') => `<div class="metric"><div class="mi ${color}">${icon}</div><div class="mtext"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div></div>`;
  const rows = [
    metric('Uptime', stats.uptime, '◷'), metric('CPU usage', stats.cpu, '⌁', 'purple'),
    metric('System RAM used / total', stats.systemRam, '▣'), metric('System RAM free', stats.ramFree, '▣', 'green'),
    metric('Bot process RSS', stats.botRam, '▤', 'purple'), metric('Bot heap', stats.botHeap, '▤'),
    metric('Platform', stats.hostPlatform, '☁'), metric('Operating system', stats.platform, '⌘', 'green'),
    metric('Node.js', stats.node, '⬡', 'purple'), metric('CPU cores / load avg', `${stats.cpuCount} / ${stats.load}`, '⌁'),
  ].join('');
  const isPing = type === 'ping';
  const uptime = type === 'uptime' ? `<div class="bigvalue">${escapeHtml(stats.uptime)}</div><div class="sub">DAYS · HOURS · MINUTES · SECONDS</div>` : '';
  const extra = isPing ? `<div class="bigvalue">${escapeHtml(stats.pingValue || detail || 'Unavailable')}</div><div class="sub">${escapeHtml(stats.pingLabel || title || 'RESPONSE TIME')}</div><p class="detail">${escapeHtml(detail || '')}</p>` : `<div class="headline">${escapeHtml(title || (type === 'connected' ? 'CONNECTED' : 'BOT IS ALIVE'))}</div><p class="detail">${escapeHtml(detail || (type === 'connected' ? 'Connection established and ready' : 'Running smoothly and ready!'))}</p>`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
  *{box-sizing:border-box}body{margin:0;background:#03070d;color:#e8f5ff;font-family:Arial,Helvetica,sans-serif;padding:20px;background-image:radial-gradient(circle at 50% 10%,#062344 0,transparent 44%),linear-gradient(135deg,#03070d,#02040a)}.frame{width:100%;max-width:720px;margin:auto;border:2px solid #0799ff;border-radius:26px;padding:12px;box-shadow:0 0 18px #009dff90,inset 0 0 18px #009dff20}.hero{border:1px solid #18baff;border-radius:22px;min-height:245px;display:flex;align-items:center;justify-content:center;position:relative;overflow:hidden;background:linear-gradient(135deg,#04152a,#01050a)}.hero:before{content:'';position:absolute;inset:0;background:radial-gradient(circle,#006cff55,transparent 65%),repeating-linear-gradient(120deg,transparent 0 30px,#00aaff10 31px 32px}.logo{width:190px;height:190px;border:4px solid #00b9ff;border-radius:50%;box-shadow:0 0 20px #00aaff;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#020711;z-index:1;text-align:center;position:relative;overflow:hidden}.logo img{width:100%;height:100%;object-fit:cover;position:absolute;inset:0;opacity:.45;border-radius:50%}.brand{font-size:27px;font-weight:900;letter-spacing:1px;text-shadow:0 0 9px #00aaff;z-index:2}.powered{font-size:12px;letter-spacing:3px;color:#74eaff;z-index:2}.status{margin:12px 0;border:1px solid #00baff;border-radius:24px;padding:14px 20px;display:flex;justify-content:space-between;align-items:center;background:#030c17;box-shadow:0 0 10px #00aaff45}.brandname{font-size:26px;font-weight:900;font-style:italic;text-shadow:0 0 9px #00baff}.pill{border:1px solid #00ff67;border-radius:24px;padding:7px 16px;color:#a6ffc5;background:#06220f;font-weight:bold;box-shadow:0 0 10px #00ff4050}.dot{display:inline-block;background:#00ff63;width:12px;height:12px;border-radius:50%;margin-right:7px;box-shadow:0 0 8px #00ff55}.headline{color:#36dfff;font-size:29px;font-weight:900;text-align:center;margin:12px 0;text-shadow:0 0 8px #009dff}.detail{text-align:center;font-size:17px;margin:5px 0 15px;color:#fff}.bigvalue{text-align:center;font-size:42px;font-weight:900;margin:15px 0 2px;text-shadow:0 0 13px #00aaff}.sub{text-align:center;color:#b5d7ee;font-size:12px;margin-bottom:15px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:9px}.metric{display:flex;gap:11px;align-items:center;padding:10px;border:1px solid #075d9b;border-radius:12px;background:linear-gradient(120deg,#03111e,#02070d);min-height:65px}.mi{font-size:22px;color:#20cfff;text-shadow:0 0 8px currentColor}.mi.purple{color:#b17bff}.mi.green{color:#44ff86}.mtext span{display:block;font-size:12px;color:#8fb6ce;margin-bottom:4px}.mtext strong{font-size:14px;overflow-wrap:anywhere}.time{margin-top:12px;text-align:center;color:#9dd7ef;font-size:13px;border-top:1px solid #0873b5;padding:12px}.footer{text-align:center;border:1px solid #078bcb;border-radius:20px;padding:13px;margin-top:12px;font-weight:bold;color:#23dfff;text-shadow:0 0 7px #009dff}.footer small{display:block;color:#d8e8f5;font-weight:normal;margin-top:4px}.missing{font-size:13px;color:#a4c8dd}
  @media(max-width:520px){body{padding:8px}.frame{padding:7px}.brandname{font-size:20px}.pill{padding:5px 9px;font-size:12px}.grid{grid-template-columns:1fr}.headline{font-size:24px}.bigvalue{font-size:30px}.hero{min-height:180px}.logo{width:150px;height:150px}}
  </style></head><body><div class="frame"><div class="hero"><div class="logo">${imageSrc ? `<img src="${imageSrc}" alt="Menu artwork">` : ''}<div class="brand">TEDDY-XMD</div><div class="powered">POWERED BY TEDDY</div></div></div><div class="status"><div class="brandname">TEDDY-XMD</div><div class="pill"><i class="dot"></i>${escapeHtml(status)}</div></div>${extra}${uptime}<div class="grid">${rows}</div><div class="time">▦ ${escapeHtml(stats.time)}${type === 'uptime' ? ` · Started: ${escapeHtml(stats.startTime)}` : ''}</div><div class="footer">♛ TEDDY-XMD SYSTEM ♛<small>Always Online · Always Ready</small></div></div></body></html>`;
}

async function renderPng(html) {
  if (!puppeteer) throw new Error('Puppeteer is not installed. Install project dependencies to enable HTML dashboard rendering.');
  let browser;
  try {
    browser = await puppeteer.launch({ headless: true, ...(process.env.PUPPETEER_EXECUTABLE_PATH ? { executablePath: process.env.PUPPETEER_EXECUTABLE_PATH } : {}), args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
    const page = await browser.newPage({ viewport: { width: 720, height: 1280 }, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30000 });
    const element = await page.$('.frame');
    if (!element) throw new Error('Dashboard layout was not rendered');
    return await element.screenshot({ type: 'png' });
  } finally { if (browser) await browser.close().catch(() => {}); }
}

async function createDashboard({ type = 'alive', title, detail, status = 'ONLINE', extraStats = {} } = {}) {
  const report = await getSystemReport();
  const stats = getStats(report);
  Object.assign(stats, extraStats);
  const menuImage = getMenuImageBuffer();
  if (!menuImage?.length) throw new Error('Configured menu image could not be resolved; dashboard image rendering aborted.');
  const html = dashboardHtml({ type, title, detail, status, stats, menuImage });
  const png = await renderPng(html);
  return { png, stats, html };
}

async function sendDashboard(sock, chatId, options = {}, quoted) {
  const { png, stats } = await createDashboard(options);
  await sock.sendMessage(chatId, { image: png, mimetype: 'image/png', caption: `TEDDY-XMD · ${options.title || options.type || 'STATUS'} · ${stats.uptime}` }, quoted ? { quoted } : undefined);
  return stats;
}

module.exports = { escapeHtml, getStats, dashboardHtml, renderPng, createDashboard, sendDashboard };
