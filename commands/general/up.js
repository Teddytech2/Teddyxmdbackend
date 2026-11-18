/**
 * Uptime command - cyber status card with the bot's circular profile picture.
 */
const os = require('os');
const sharp = require('sharp');

function detectPlatform() {
  if (process.env.JHP_PLATFORM) return 'J.H.P';
  if (process.env.DYNO) return 'Heroku';
  if (process.env.RENDER) return 'Render';
  if (process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID) return 'Railway';
  if (process.env.REPLIT_SLUG || process.env.REPL_ID) return 'Replit';
  if (process.env.PREFIX && process.env.PREFIX.includes('termux')) return 'Termux';
  if (process.env.P_SERVER_UUID) return 'Panel';
  if (process.env.LXC) return 'Linux Container';
  return ({ win32: 'Windows', darwin: 'macOS', linux: 'Linux' })[os.platform()] || os.platform();
}

function formatUptime(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${d}d ${h}h ${m}m ${sec}s`;
}

async function getCircularProfile(sock) {
  try {
    const botJid = sock.user?.id;
    if (!botJid || typeof sock.profilePictureUrl !== 'function') return null;
    const url = await sock.profilePictureUrl(botJid, 'image');
    if (!url) return null;
    const response = await fetch(url);
    if (!response.ok) return null;
    const input = Buffer.from(await response.arrayBuffer());
    const size = 640;
    const circle = Buffer.from(
      `<svg width="${size}" height="${size}"><circle cx="${size/2}" cy="${size/2}" r="${size/2}" fill="white"/></svg>`
    );
    return await sharp(input)
      .resize(size, size, { fit: 'cover', position: 'centre' })
      .composite([{ input: circle, blend: 'dest-in' }])
      .png()
      .toBuffer();
  } catch (error) {
    console.error('[uptime] profile image unavailable:', error.message);
    return null;
  }
}

module.exports = {
  name: 'uptime',
  aliases: ['runtime', 'botuptime', 'up'],
  category: 'general',
  description: 'Show bot uptime and server information',
  usage: '.uptime',

  async execute(sock, msg, args, extra) {
    try {
      const mem = process.memoryUsage();
      const totalMem = os.totalmem();
      const usedSystemMem = totalMem - os.freemem();
      const cpuPercent = os.cpus().length
        ? `${os.cpus().length} cores`
        : 'Unavailable';
      const chatId = extra.from || msg.key?.remoteJid;
      const text = [
        '╭━━━〔 ⚡ TEDDY-XMD STATUS 〕━━━╮',
        '',
        '        🟢 *SYSTEM ONLINE*',
        '',
        `⏱️ *Uptime:* ${formatUptime(process.uptime())}`,
        `🖥️ *Platform:* ${detectPlatform()}`,
        `⚙️ *CPU:* ${cpuPercent}`,
        `💾 *Bot RAM:* ${(mem.heapUsed / 1048576).toFixed(1)} MB / ${(mem.heapTotal / 1048576).toFixed(1)} MB`,
        `📊 *Server RAM:* ${(usedSystemMem / 1073741824).toFixed(2)} GB / ${(totalMem / 1073741824).toFixed(2)} GB`,
        `🟦 *Node.js:* ${process.version}`,
        '',
        '╰━━━━━━━━━━━━━━━━━━━━━━━━╯',
        '_TEDDY-XMD • Cyber system monitor_'
      ].join('\n');

      const image = await getCircularProfile(sock);
      if (image && chatId) {
        await sock.sendMessage(chatId, { image, caption: text }, { quoted: msg });
      } else {
        await extra.reply(text);
      }
    } catch (error) {
      console.error('Error in uptime command:', error);
      await extra.reply('❌ Could not fetch uptime information. Please try again.');
    }
  }
};
