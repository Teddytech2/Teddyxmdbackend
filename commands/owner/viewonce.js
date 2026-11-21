/**
 * Safe View Once diagnostics for TEDDY-XMD.
 *
 * This command intentionally does not download, copy, or re-send View Once
 * media. It identifies the quoted message shape and reports whether Baileys
 * supplied media download metadata. This avoids treating an incomplete quoted
 * preview as a downloadable original.
 */

const MEDIA_TYPES = ['imageMessage', 'videoMessage', 'audioMessage'];
const WRAPPERS = [
  'ephemeralMessage',
  'viewOnceMessageV2Extension',
  'viewOnceMessageV2',
  'viewOnceMessage',
  'documentWithCaptionMessage',
];

function getContextInfo(message) {
  if (!message || typeof message !== 'object') return null;
  for (const value of Object.values(message)) {
    if (value && typeof value === 'object' && value.contextInfo?.quotedMessage) {
      return value.contextInfo;
    }
  }
  return null;
}

function unwrapMessage(input) {
  let current = input;
  const seen = new Set();
  let isViewOnce = false;

  // Bound traversal and guard against malformed/cyclic objects.
  for (let i = 0; i < 8 && current && typeof current === 'object'; i++) {
    if (seen.has(current)) break;
    seen.add(current);

    let advanced = false;
    for (const wrapper of WRAPPERS) {
      const nested = current[wrapper]?.message;
      if (nested && typeof nested === 'object') {
        if (wrapper.startsWith('viewOnce')) isViewOnce = true;
        current = nested;
        advanced = true;
        break;
      }
    }
    if (advanced) continue;

    for (const type of MEDIA_TYPES) {
      if (current[type]?.viewOnce === true) isViewOnce = true;
    }
    break;
  }

  const mediaType = MEDIA_TYPES.find((type) => current?.[type]);
  const media = mediaType ? current[mediaType] : null;
  return { isViewOnce, mediaType, media };
}

module.exports = {
  name: 'viewonce',
  aliases: ['vv', 'vv2', 'rvo', 'readvo', 'readviewonce'],
  category: 'owner',
  ownerOnly: true,
  description: 'Diagnose a quoted View Once message',
  usage: '.vv (reply to a View Once message)',

  async execute(sock, msg, args, extra) {
    const chatId = extra?.from || msg.key?.remoteJid;
    const ctx = getContextInfo(msg.message);

    if (!ctx?.quotedMessage) {
      return sock.sendMessage(chatId, {
        text: 'Reply directly to the message you want to diagnose, then send .vv.',
      }, { quoted: msg });
    }

    const { isViewOnce, mediaType, media } = unwrapMessage(ctx.quotedMessage);
    if (!isViewOnce) {
      return sock.sendMessage(chatId, {
        text: 'The quoted message does not appear to be a View Once message. Check that you replied to the original message, not a forwarded or text-only preview.',
      }, { quoted: msg });
    }

    if (!mediaType || !media) {
      return sock.sendMessage(chatId, {
        text: 'View Once wrapper detected, but no image/video/audio payload was present in the quoted message. The quoted preview is incomplete; this command cannot reconstruct media that WhatsApp did not include.',
      }, { quoted: msg });
    }

    const hasDirectPath = typeof media.directPath === 'string' && media.directPath.length > 0;
    const hasUrl = typeof media.url === 'string' && media.url.length > 0;
    const hasMediaKey = Boolean(media.mediaKey);

    const metadata = [
      `Media type: ${mediaType}`,
      `directPath: ${hasDirectPath ? 'present' : 'missing'}`,
      `URL: ${hasUrl ? 'present' : 'missing'}`,
      `mediaKey: ${hasMediaKey ? 'present' : 'missing'}`,
    ].join('\n');

    return sock.sendMessage(chatId, {
      text: `View Once message structure detected.\n\n${metadata}\n\nThis diagnostic command does not download or re-send View Once media. If the metadata is missing, the quoted message supplied by WhatsApp is incomplete; ask the sender to share it as a normal photo/video if you need a copy.`,
    }, { quoted: msg });
  },
};

module.exports._diagnostics = { getContextInfo, unwrapMessage };
