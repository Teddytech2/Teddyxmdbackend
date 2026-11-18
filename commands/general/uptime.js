
'use strict';

const {
  getSystemReport,
  sendStatus
} = require('../../utils/statusCard');

module.exports = {
  name: 'uptime',
  aliases: ['up'],
  category: 'general',
  description: 'Show bot uptime',
  usage: '.uptime',
  ownerOnly: false,

  async execute(sock, msg, args, extra) {
    try {
      const report = await getSystemReport();

      await sendStatus(
        sock,
        extra,
        report,
        false
      );

    } catch (error) {
      console.error('[UPTIME ERROR]', error);

      await extra.reply(
        '❌ Uptime failed: ' + error.message
      );
    }
  }
};
