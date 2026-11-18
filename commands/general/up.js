'use strict';

const { getSystemReport, sendStatus } = require('../../utils/statusCard');

module.exports = {
  name: 'uptime',
  aliases: ['runtime', 'botuptime', 'up'],
  category: 'general',
  description: 'Show the live bot uptime and detailed resource report',
  usage: '.uptime',
  ownerOnly: false,

  async execute(sock, msg, args, extra) {
    const report = await getSystemReport();
    await sendStatus(sock, extra, report, false);
  }
};
