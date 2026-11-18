'use strict';
const { sendDashboard } = require('../../utils/cyberDashboard');
module.exports = {
  name: 'uptime', aliases: ['up'], category: 'general',
  description: 'Detailed live bot uptime and system dashboard', usage: '.uptime', ownerOnly: false,
  async execute(sock, msg, args, extra) {
    await sendDashboard(sock, extra.from, { type: 'uptime', title: 'BOT UPTIME', detail: 'Detailed uptime and system monitor', status: global.botState === 'connected' ? 'ONLINE' : String(global.botState || 'UNKNOWN').toUpperCase() }, msg);
  }
};
