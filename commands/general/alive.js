'use strict';
const { sendDashboard } = require('../../utils/cyberDashboard');
module.exports = {
  name: 'alive', aliases: ['botcheck'], category: 'general',
  description: 'Show bot online status and active uptime', usage: '.alive', ownerOnly: false,
  async execute(sock, msg, args, extra) {
    try {
      await sendDashboard(sock, extra.from, {
        type: 'alive', title: 'BOT IS ALIVE',
        detail: 'The service is active and ready for commands',
        status: global.botState === 'connected' ? 'ONLINE' : String(global.botState || 'UNKNOWN').toUpperCase(),
      }, msg);
    } catch (error) {
      console.error('[alive dashboard]', error?.stack || error);
      await extra.reply('❌ Alive card could not be sent. Check that Chromium/Puppeteer is installed and available on your host.');
    }
  },
};
