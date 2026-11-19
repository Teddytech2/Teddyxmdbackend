/**
 * ViewOnce command.
 * .vv  -> send revealed media to the bot's own private chat
 * .vv2 -> send revealed media in the current chat
 *
 * WhatsApp may omit the binary media fields from contextInfo. In that case,
 * resolve the original stanza from the bot's message store before downloading.
 */
const fs = require('fs');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const { createTempFilePath, deleteTempFile } = require('../../utils/tempManager');

const WRAPPERS = [
  'ephemeralMessage',
  'viewOnceMessage',
  'viewOnceMessageV2',
  'viewOnceMessageV2Extension',
  'documentWithCaptionMessage',
  'deviceSentMessage',
];
const MEDIA_TYPES = new Set(['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage', 'stickerMessage']);

function unwrapMessage(message) {
  let current = message;
  const seen = new Set();
  for (let depth = 0; current && depth < 12; depth++) {
    if (seen.has(current)) break;
    seen.add(current);
    const wrapper = WRAPPERS.find((key) => current[key]?.message);
    if (wrapper) {
      current = current[wrapper].message;
      continue;
    }
    const type = Object.keys(current).find((key) => MEDIA_TYPES.has(key));
    if (type) return { type, media: current[type], message: current };
    // Some message objects contain an extra message envelope.
    if (current.message && typeof current.message === 'object') {
      current = current.message;
      continue;
    }
    break;
  }
  return null;
}

function isViewOnce(message) {
  let current = message;
  for (let depth = 0; current && depth < 12; depth++) {
    if (current.viewOnceMessage || current.viewOnceMessageV2 || current.viewOnceMessageV2Extension) return true;
    const type = Object.keys(current).find((key) => MEDIA_TYPES.has(key));
    if (type && current[type]?.viewOnce) return true;
    const wrapper = WRAPPERS.find((key) => current[key]?.message);
    if (!wrapper) break;
    current = current[wrapper].message;
  }
  return false;
}

function getContextInfo(msg) {
  const candidates = [
    msg.message?.extendedTextMessage?.contextInfo,
    msg.message?.imageMessage?.contextInfo,
    msg.message?.videoMessage?.contextInfo,
    msg.message?.audioMessage?.contextInfo,
    msg.message?.documentMessage?.contextInfo,
    msg.message?.stickerMessage?.contextInfo,
    msg.message?.buttonsResponseMessage?.contextInfo,
    msg.message?.listResponseMessage?.contextInfo,
    msg.message?.templateButtonReplyMessage?.contextInfo,
  ];
  return candidates.find((ctx) => ctx?.stanzaId || ctx?.quotedMessage) || null;
}

async function findOriginal(sock, ctx, chatId) {
  const id = ctx?.stanzaId;
  const quoted = ctx?.quotedMessage;
  if (!id) return quoted || null;
  const store = sock.botStore;
  const possibleJids = [...new Set([ctx.remoteJid, chatId].filter(Boolean))];
  if (store?.loadMessage) {
    for (const jid of possibleJids) {
      try {
        const saved = await store.loadMessage(jid, id);
        if (saved?.message) return saved.message;
      } catch (_) {}
    }
    // LID/phone-number aliases can differ from the reply's remoteJid.
    try {
      for (const [, byId] of store.messages || []) {
        const saved = byId?.get(id);
        if (saved?.message && (!saved.key?.remoteJid || possibleJids.includes(saved.key.remoteJid))) return saved.message;
      }
    } catch (_) {}
  }
  return quoted || null;
}

module.exports = {
  name: 'viewonce',
  aliases: ['vv', 'vv2', 'rvo', 'readvo', 'readviewonce'],
  category: 'owner',
  ownerOnly: true,
  description: 'Reveal view-once messages — .vv sends privately | .vv2 sends here',
  usage: '.vv (reply to a view-once) | .vv2 (reply to display here)',

  async execute(sock, msg, args, extra) {
    const chatId = extra.from;
    const selfJid = sock.user.id.split(':')[0] + '@s.whatsapp.net';
    const sendToCurrentChat = String(extra.command || '').toLowerCase() === 'vv2';
    const targetJid = sendToCurrentChat ? chatId : selfJid;
    let tmpPath = null;

    try {
      const ctx = getContextInfo(msg);
      if (!ctx || (!ctx.stanzaId && !ctx.quotedMessage)) {
        return await sock.sendMessage(chatId, {
          text: sendToCurrentChat
            ? '🗑️ Reply to the original view-once message with *.vv2*.'
            : '🗑️ Reply to the original view-once message with *.vv*.'
        }, { quoted: msg });
      }

      const original = await findOriginal(sock, ctx, chatId);
      if (!original) {
        return await sock.sendMessage(chatId, {
          text: '❌ I could not retrieve the original message. Receive the view-once message while the bot is online, then reply directly to it with .vv.'
        }, { quoted: msg });
      }
      if (!isViewOnce(original)) {
        return await sock.sendMessage(chatId, { text: '❌ The original message is not marked as view-once.' }, { quoted: msg });
      }

      const extracted = unwrapMessage(original);
      if (!extracted) {
        return await sock.sendMessage(chatId, { text: '❌ The original view-once message contains no supported media payload.' }, { quoted: msg });
      }
      const { type, media } = extracted;
      if (!media?.mediaKey || (!media?.url && !media?.directPath)) {
        return await sock.sendMessage(chatId, {
          text: '❌ WhatsApp did not provide the media key or download path in the stored original message. The media cannot be recovered from this copy; try a newly received view-once message.'
        }, { quoted: msg });
      }

      const downloadType = type === 'imageMessage' ? 'image'
        : type === 'videoMessage' ? 'video'
        : type === 'audioMessage' ? 'audio'
        : type === 'stickerMessage' ? 'sticker' : 'document';
      const ext = type === 'imageMessage' ? 'jpg'
        : type === 'videoMessage' ? 'mp4'
        : type === 'audioMessage' ? 'mp3'
        : type === 'stickerMessage' ? 'webp'
        : (String(media.mimetype || '').split('/')[1] || 'bin').replace(/[^a-z0-9]/gi, '') || 'bin';

      tmpPath = createTempFilePath('vv', ext);
      const input = await downloadContentFromMessage(media, downloadType);
      const output = fs.createWriteStream(tmpPath);
      await new Promise((resolve, reject) => {
        input.on('error', reject);
        output.on('error', reject);
        output.on('finish', resolve);
        input.pipe(output);
      });
      if (!fs.existsSync(tmpPath) || fs.statSync(tmpPath).size === 0) throw new Error('WhatsApp returned an empty media stream');

      const caption = media.caption || '';
      if (type === 'imageMessage') {
        await sock.sendMessage(targetJid, { image: { url: tmpPath }, caption: caption || '🖼️ View-once image' });
      } else if (type === 'videoMessage') {
        await sock.sendMessage(targetJid, { video: { url: tmpPath }, caption: caption || '🎬 View-once video', mimetype: media.mimetype || 'video/mp4' });
      } else if (type === 'audioMessage') {
        await sock.sendMessage(targetJid, { audio: { url: tmpPath }, mimetype: media.mimetype || 'audio/ogg; codecs=opus', ptt: !!media.ptt });
      } else if (type === 'stickerMessage') {
        await sock.sendMessage(targetJid, { sticker: { url: tmpPath } });
      } else {
        await sock.sendMessage(targetJid, { document: { url: tmpPath }, mimetype: media.mimetype || 'application/octet-stream', fileName: media.fileName || `view-once.${ext}`, caption });
      }
      await sock.sendMessage(chatId, { react: { text: '✅', key: msg.key } });
    } catch (error) {
      await sock.sendMessage(chatId, { text: `❌ Failed to reveal view-once: ${error.message || 'Unknown error'}` }, { quoted: msg });
    } finally {
      if (tmpPath) deleteTempFile(tmpPath);
    }
  }
};
