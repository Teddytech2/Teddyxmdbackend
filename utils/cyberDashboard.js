'use strict';

const os = require('os');
const { getMenuImageBuffer, getSystemReport, formatDuration, formatBytes } = require('./statusCard');

let puppeteer = null;
try { puppeteer = require('puppeteer'); } catch (_) {}

function escapeHtml(value) {
  return String(value ?? 'Unavailable').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function getStats(report) {
  const total = os.totalmem();
  const free = os.freemem();
  const memory = process.memoryUsage();
  const cpus = os.cpus() || [];
  const uptimeSeconds = Math.floor(process.uptime());
  return {
    uptime: (() => { const d = Math.floor(uptimeSeconds / 86400); const h = Math.floor((uptimeSeconds % 86400) / 3600); const m = Math.floor((uptimeSeconds % 3600) / 60); const s = uptimeSeconds % 60; return d ? `${d} d ${h} h ${m} min ${s} s` : `${h} h ${m} min ${s} s`; })(),
    uptimeSeconds,
    cpu: report.cpu || 'Unavailable',
    cpuCount: cpus.length || 'Unavailable',
    runtime: `Node ${process.version}`,
    platform: report.platform || 'Unavailable',
    systemRam: `${formatBytes(total - free)} / ${formatBytes(total)}`,
    botRam: formatBytes(memory.rss),
    botHeap: `${formatBytes(memory.heapUsed)} / ${formatBytes(memory.heapTotal)}`,
    time: report.timestamp || new Date().toLocaleString(),
    startTime: new Date(Date.now() - uptimeSeconds * 1000).toLocaleString(),
  };
}

function dashboardHtml({ type = 'alive', title, status = 'ONLINE', detail = '', stats, menuImage, extraStats = {} }) {
  const mime = menuImage?.[0] === 0x89 && menuImage?.[1] === 0x50 ? 'image/png'
    : menuImage?.[0] === 0xff && menuImage?.[1] === 0xd8 ? 'image/jpeg' : 'image/webp';
  const imageSrc = menuImage?.length ? `data:${mime};base64,${menuImage.toString('base64')}` : '';
  const isPing = type === 'ping';
  const latency = extraStats.latencyValue || (isPing ? '—' : '—');
  const heading = title || (isPing ? 'PING RESPONSE' : type === 'uptime' ? 'BOT ACTIVE UPTIME' : 'BOT IS ALIVE');
  const message = detail || (isPing ? 'Latency check completed' : 'The service is active and ready for commands');
  const uptimeLabel = stats.uptime || 'Unavailable';
  const currentTime = stats.time || new Date().toLocaleString();
  const brand = escapeHtml(process.env.BOT_NAME || 'TEDDY-XMD');
  const logo = imageSrc
    ? `<img src="${imageSrc}" alt="Bot profile">`
    : `<span class="robot">🤖</span>`;
  const uptimePanel = `<section class="uptime"><div class="eyebrow">⏱ BOT ACTIVE UPTIME</div><div class="big">${escapeHtml(uptimeLabel)}</div><div class="sub">Time: ${escapeHtml(currentTime)}</div></section>`;
  const metrics = isPing
    ? `<div class="metrics"><section><small>LATENCY SPEED</small><strong>${escapeHtml(latency)}</strong></section><section><small>CPU CORES</small><strong>${escapeHtml(stats.cpuCount)} Core</strong></section></div>`
    : `<div class="metrics"><section><small>${isPing ? 'LATENCY SPEED' : 'CPU USAGE'}</small><strong>${escapeHtml(isPing ? latency : stats.cpu)}</strong></section><section><small>CPU CORES</small><strong>${escapeHtml(stats.cpuCount)} Core</strong></section></div>`;
  const runtime = `<section class="runtime"><small>RUNTIME ENGINE</small><strong>${escapeHtml(stats.runtime || process.version)}</strong></section>`;
  const optional = type === 'uptime'
    ? `<section class="runtime"><small>SYSTEM MEMORY</small><strong>${escapeHtml(stats.systemRam)}</strong></section>`
    : '';
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
  *{box-sizing:border-box}body{margin:0;padding:20px;background:#030813;color:#eaf3ff;font-family:Arial,Helvetica,sans-serif}
  .card{width:100%;max-width:840px;margin:auto;padding:26px;border:1px solid #153b65;border-radius:34px;background:linear-gradient(145deg,#071629,#050b18 65%,#081326);box-shadow:0 12px 45px #0009,inset 0 0 28px #0b4b8120}
  .top{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:0 4px 20px;border-bottom:1px solid #1b2d47}
  .identity{display:flex;align-items:center;gap:13px;font-size:28px;font-weight:800}.avatar{width:46px;height:46px;border-radius:50%;overflow:hidden;display:grid;place-items:center;background:#10243b;border:1px solid #1a4e7b}.avatar img{width:100%;height:100%;object-fit:cover}.robot{font-size:26px}
  .pill{white-space:nowrap;padding:10px 18px;border-radius:24px;background:#092541;border:1px solid #145b91;color:#65caff;font-size:15px;font-weight:800;letter-spacing:.5px}.dot{display:inline-block;width:11px;height:11px;margin-right:8px;border-radius:50%;background:#24caff;box-shadow:0 0 12px #24caff}
  .uptime{margin:24px 0 18px;padding:28px 15px;text-align:center;border:1px solid #164779;border-radius:28px;background:linear-gradient(120deg,#0a1e36,#09152b);box-shadow:inset 0 0 22px #0069aa16}
  .eyebrow{font-size:16px;font-weight:800;letter-spacing:3px;color:#55baff}.big{font-size:42px;font-weight:900;margin:12px 0 5px;letter-spacing:.4px}.sub{font-size:16px;color:#a5b9d1}
  .metrics{display:grid;grid-template-columns:1fr 1fr;gap:16px}.metrics section,.runtime{padding:20px 22px;border:1px solid #1a2c45;border-radius:23px;background:linear-gradient(135deg,#0b1729,#08111f)}
  small{display:block;color:#879bb6;font-size:14px;font-weight:800;letter-spacing:1.6px;margin-bottom:12px}.metrics strong,.runtime strong{font-size:23px;font-weight:800}
  .runtime{margin-top:16px}.ready{margin-top:18px;padding:18px 22px;border:1px solid #174b43;border-radius:24px;background:#071b20;color:#60d994;font-size:17px;font-weight:700}.ready:before{content:'●';font-size:23px;color:#5ad987;margin-right:12px}
  .bottom{display:flex;justify-content:space-between;gap:10px;margin-top:22px;padding-top:18px;border-top:1px solid #1b2d47;color:#8295ae;font-size:13px}.engine{color:#56c6ff;font-weight:800}
  @media(max-width:560px){body{padding:8px}.card{padding:15px;border-radius:24px}.identity{font-size:21px}.avatar{width:38px;height:38px}.pill{font-size:11px;padding:8px 10px}.uptime{padding:22px 8px}.eyebrow{font-size:12px;letter-spacing:2px}.big{font-size:30px}.sub{font-size:12px}.metrics{gap:9px}.metrics section,.runtime{padding:15px 12px;border-radius:17px}small{font-size:10px;letter-spacing:1px}.metrics strong,.runtime strong{font-size:17px}.ready{font-size:13px;padding:14px}.bottom{font-size:10px}}
  </style></head><body><main class="card"><header class="top"><div class="identity"><span class="avatar">${logo}</span><span>${brand}</span></div><div class="pill"><i class="dot"></i>${escapeHtml(status === 'ONLINE' ? 'SYSTEM ONLINE' : status)}</div></header>
  ${uptimePanel}${metrics}${runtime}${optional}<div class="ready">${escapeHtml(message)}</div><footer class="bottom"><span>Updated just now</span><span class="engine">✦ TEDDY-XMD ENGINE</span></footer></main></body></html>`;
}

async function renderPng(html) {
  if (!puppeteer) throw new Error('Puppeteer is not installed. Install project dependencies to enable status cards.');
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      ...(process.env.PUPPETEER_EXECUTABLE_PATH ? { executablePath: process.env.PUPPETEER_EXECUTABLE_PATH } : {}),
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
    const page = await browser.newPage({ viewport: { width: 840, height: 1100 }, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: 'load', timeout: 30000 });
    const element = await page.$('.card');
    if (!element) throw new Error('Status card did not render');
    return await element.screenshot({ type: 'png' });
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

async function createDashboard({ type = 'alive', title, detail, status = 'ONLINE', extraStats = {} } = {}) {
  const report = await getSystemReport();
  const stats = getStats(report);
  const menuImage = getMenuImageBuffer();
  const html = dashboardHtml({ type, title, detail, status, stats, menuImage, extraStats });
  const png = await renderPng(html);
  return { png, stats, html };
}

async function sendDashboard(sock, chatId, options = {}, quoted) {
  const { png, stats } = await createDashboard(options);
  await sock.sendMessage(chatId, {
    image: png,
    mimetype: 'image/png',
    caption: `${process.env.BOT_NAME || 'TEDDY-XMD'} · ${String(options.type || 'STATUS').toUpperCase()} · ${stats.uptime}`,
  }, quoted ? { quoted } : undefined);
  return stats;
}

module.exports = { escapeHtml, getStats, dashboardHtml, renderPng, createDashboard, sendDashboard };
