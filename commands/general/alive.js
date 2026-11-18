'use strict';

const { getSystemReport, sendStatus } = require('../../utils/statusCard');

module.exports = {
  name: 'alive',
  aliases: ['botcheck'],
  category: 'general',
  description: 'Show live bot status and system resources',
  usage: '.alive',
  ownerOnly: false,

  async execute(sock, msg, args, extra) {
    const report = await getSystemReport();
    await sendStatus(sock, extra, report, true);
  }
};
