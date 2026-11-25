'use strict';

const util = require('util');

function getQuotedContext(message) {
  if (!message || typeof message !== 'object') return null;
  const queue = [message];
  const seen = new Set();
  while (queue.length) {
    const current = queue.shift();
    if (!current || typeof current !== 'object' || seen.has(current)) continue;
    seen.add(current);
    if (current.contextInfo && current.contextInfo.quotedMessage) return current.contextInfo;
    for (const value of Object.values(current)) {
      if (value && typeof value === 'object') queue.push(value);
    }
  }
  return null;
}

function getText(message) {
  return message?.conversation || message?.extendedTextMessage?.text ||
    message?.imageMessage?.caption || message?.videoMessage?.caption ||
    message?.documentMessage?.caption || '';
}

module.exports = {
  name: 'quoted',
  aliases: ['mquoted', 'qinspect'],
  category: 'owner',
  description: 'Display the full m.quoted-style Baileys message object',
  usage: '.quoted (reply to a message)',
  ownerOnly: true,

  async execute(sock, msg, args, extra) {
    const context = getQuotedContext(msg?.message);
    if (!context?.quotedMessage) {
      return extra.reply('Reply to a WhatsApp message and send .quoted to inspect it.');
    }

    const raw = context.quotedMessage;
    const mtype = Object.keys(raw)[0] || 'unknown';
    const chat = msg.key?.remoteJid || extra.from || '';
    const participant = context.participant || msg.key?.participant || '';
    const key = {
      remoteJid: chat,
      fromMe: false,
      id: context.stanzaId || '',
      ...(participant ? { participant } : {})
    };

    // Recreate the same useful m.quoted wrapper shape shown by Baileys-based
    // Teddy bots. Keep the circular message reference so util.inspect prints
    // <ref *1> and [Circular *1], rather than flattening it into JSON.
    function ExtendedTextMessage() {}
    const quoted = Object.assign(new ExtendedTextMessage(), {
      endCardTiles: [],
      viewOnce: Boolean(raw[mtype]?.viewOnce || raw.viewOnceMessage || raw.viewOnceMessageV2),
      mtype,
      chat,
      id: context.stanzaId || '',
      sender: participant || chat,
      fromMe: false,
      mentionedJid: raw[mtype]?.contextInfo?.mentionedJid || [],
      isBaileys: false,
      text: getText(raw),
      message: null,
      origType: mtype,
      fakeObj: {
        messageStubParameters: [],
        labels: [],
        userReceipt: [],
        reactions: [],
        pollUpdates: [],
        eventResponses: [],
        statusMentions: [],
        messageAddOns: [],
        statusMentionSources: [],
        supportAiCitations: [],
        decisionSources: [],
        key,
        message: null,
        ...(participant ? { participant } : {})
      },
      delete: function (anonymous) {},
      copyNForward: function (anonymous) {},
      download: function (anonymous) {}
    });
    quoted.message = { [mtype]: quoted };
    quoted.fakeObj.message = quoted.message;

    const output = util.inspect(quoted, {
      depth: 10,
      colors: false,
      compact: false,
      breakLength: 78,
      maxArrayLength: null,
      maxStringLength: 12000,
      getters: false
    });

    // WhatsApp has a practical message-size ceiling. Preserve the beginning
    // of util.inspect output (where the wrapper and metadata are shown).
    const MAX = 12000;
    const safeOutput = output.length > MAX
      ? output.slice(0, MAX) + '\n... [output truncated]'
      : output;
    return extra.reply(safeOutput);
  }
};
