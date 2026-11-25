'use strict';

function findContextInfo(node, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 8) return null;
  if (node.contextInfo && typeof node.contextInfo === 'object') return node.contextInfo;
  for (const value of Object.values(node)) {
    if (value && typeof value === 'object') {
      const found = findContextInfo(value, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

function safeStringify(value) {
  const seen = new WeakSet();
  return JSON.stringify(value, (key, item) => {
    if (typeof item === 'bigint') return item.toString();
    if (item && typeof item === 'object') {
      if (seen.has(item)) return '[Circular]';
      seen.add(item);
    }
    if (typeof item === 'function') return `[Function ${item.name || 'anonymous'}]`;
    return item;
  }, 2);
}

module.exports = {
  name: 'quoted', aliases: ['mquoted', 'qinspect'], category: 'owner',
  description: 'Inspect the full structure of a replied-to WhatsApp message',
  usage: '.quoted (reply to a message)', ownerOnly: true,
  async execute(sock, msg, args, extra) {
    const contextInfo = findContextInfo(msg?.message);
    const quotedMessage = contextInfo?.quotedMessage;
    if (!quotedMessage) return extra.reply('Reply to a WhatsApp message and send .quoted to inspect it.');
    const result = {
      key: {
        remoteJid: msg.key?.remoteJid || extra.from || null,
        participant: contextInfo.participant || null,
        fromMe: contextInfo.participant === sock.user?.id
      },
      stanzaId: contextInfo.stanzaId || null,
      participant: contextInfo.participant || null,
      messageType: Object.keys(quotedMessage)[0] || 'unknown',
      message: quotedMessage
    };
    let output;
    try { output = safeStringify(result); }
    catch (error) { return extra.reply(`Could not serialize quoted message: ${error.message}`); }
    const MAX = 12000;
    if (output.length > MAX) output = output.slice(0, MAX) + '\n\n… [output truncated]';
    return extra.reply(`🔎 *Quoted message object*\n\n${output}`);
  }
};
