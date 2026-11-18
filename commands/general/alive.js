'use strict';
const { sendDashboard } = require('../../utils/cyberDashboard');
module.exports = {
  name: 'alive', aliases: ['botcheck'], category: 'general',
  description: 'Show a live cyber-style bot and system dashboard', usage: '.alive', ownerOnly: false,
  async execute(sock, msg, args, extra) {
    await sendDashboard(sock, extra.from, { type: 'alive', title: 'BOT IS ALIVE', detail: "I'm running smoothly and ready!", status: global.botState === 'connected' ? 'ONLINE' : String(global.botState || 'UNKNOWN').toUpperCase() }, msg);
  }
};
