'use strict';
const { sendDashboard } = require('../../utils/cyberDashboard');
module.exports = {
  name: 'uptime', aliases: ['up'], category: 'general',
  description: 'Show bot active uptime and system information', usage: '.uptime', ownerOnly: false,
  async execute(sock, msg, args, extra) {
    try {
      await sendDashboard(sock, extra.from, {
        type: 'uptime', title: 'BOT ACTIVE UPTIME',
        detail: 'The service is active and ready for commands',
        status: global.botState === 'connected' ? 'ONLINE' : String(global.botState || 'UNKNOWN').toUpperCase(),
      }, msg);
    } catch (error) {
      console.error('[uptime dashboard]', error?.stack || error);
      await extra.reply('❌ Uptime card could not be sent. Check that Chromium/Puppeteer is installed and available on your host.');
    }
  },
};
