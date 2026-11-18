'use strict';
const { performance } = require('perf_hooks');
const { sendDashboard } = require('../../utils/cyberDashboard');

module.exports = {
  name: 'ping', aliases: ['pong', 'p'], category: 'general',
  description: 'Check bot response latency and system status', usage: '.ping', ownerOnly: false,
  async execute(sock, msg, args, extra) {
    const started = performance.now();
    const receivedAt = Number(msg?.messageTimestamp) ? Number(msg.messageTimestamp) * 1000 : Date.now();
    const messageDelay = Math.max(0, Date.now() - receivedAt);
    // Incoming-message age, not a claimed end-to-end network round trip.
    const latencyValue = `${messageDelay} ms`;
    const detail = `Command processed in ${Math.max(0, performance.now() - started).toFixed(2)} ms`;
    try {
      await sendDashboard(sock, extra.from, {
        type: 'ping', title: 'PING RESPONSE', detail,
        status: global.botState === 'connected' ? 'ONLINE' : String(global.botState || 'UNKNOWN').toUpperCase(),
        extraStats: { latencyValue },
      }, msg);
    } catch (error) {
      console.error('[ping dashboard]', error?.stack || error);
      await extra.reply('❌ Ping card could not be sent. Check that Chromium/Puppeteer is installed and available on your host.');
    }
  },
};
