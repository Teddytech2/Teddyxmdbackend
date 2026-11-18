'use strict';
const { performance } = require('perf_hooks');
const { sendDashboard } = require('../../utils/cyberDashboard');
module.exports = {
  name: 'ping', aliases: ['pong', 'p'], category: 'general',
  description: 'Show measurable command-processing latency', usage: '.ping', ownerOnly: false,
  async execute(sock, msg, args, extra) {
    const started = performance.now();
    const receivedAt = Number(msg?.messageTimestamp) ? Number(msg.messageTimestamp) * 1000 : Date.now();
    const queueDelay = Math.max(0, Date.now() - receivedAt);
    const processingMs = Math.max(0, performance.now() - started);
    const detail = `Local handler entry: ${processingMs.toFixed(2)} ms · Message timestamp age (estimate): ${queueDelay} ms`; 
    try {
      const sendStart = performance.now();
      await sendDashboard(sock, extra.from, { type: 'ping', title: 'PING METRICS', detail, status: global.botState === 'connected' ? 'ONLINE' : String(global.botState || 'UNKNOWN').toUpperCase(), extraStats: { pingValue: `${queueDelay} ms`, pingLabel: 'MESSAGE TIMESTAMP AGE (EST.)' } }, msg);
      const sendMs = performance.now() - sendStart;
      // Send API duration is only known after the image send completes, so report it as text rather than pretending it was in the image.
      await extra.reply(`📡 Image-send call duration: ${sendMs.toFixed(2)} ms (local send API timing; not a WhatsApp network RTT).`);
    } catch (error) {
      console.error('[ping dashboard]', error?.message || error);
      await extra.reply('❌ Ping dashboard failed to render/send. WhatsApp network RTT is not available from this measurement.');
    }
  }
};
