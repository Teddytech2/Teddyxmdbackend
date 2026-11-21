/**
 * ViewOnce command
 * .vv  - reveal to the bot owner's private chat
 * .vv2 - reveal in the current chat
 *
 * Prefer the quoted message, but fall back to the original full message cached
 * by handler.js when WhatsApp supplies a quoted view-once stub without media
 * download fields (directPath/url/mediaKey).
 */
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');

function getQuotedContext(msg) {
    const message = msg.message || {};
    const candidates = [
        message.extendedTextMessage?.contextInfo,
        message.imageMessage?.contextInfo,
        message.videoMessage?.contextInfo,
        message.audioMessage?.contextInfo,
        message.stickerMessage?.contextInfo,
        message.buttonsResponseMessage?.contextInfo,
        message.listResponseMessage?.contextInfo,
        message.templateButtonReplyMessage?.contextInfo,
        message.interactiveResponseMessage?.contextInfo,
    ];
    return candidates.find(ctx => ctx?.quotedMessage) || null;
}

function findViewOnceMedia(root) {
    const wrappers = [
        'ephemeralMessage',
        'documentWithCaptionMessage',
        'deviceSentMessage',
        'viewOnceMessageV2Extension',
        'viewOnceMessageV2',
        'viewOnceMessage',
    ];
    const types = ['imageMessage', 'videoMessage', 'audioMessage'];
    const queue = [{ node: root, inViewOnce: false }];
    const seen = new Set();

    while (queue.length) {
        const { node, inViewOnce } = queue.shift();
        if (!node || typeof node !== 'object' || seen.has(node)) continue;
        seen.add(node);

        for (const type of types) {
            const media = node[type];
            if (media && (inViewOnce || media.viewOnce)) {
                return { media, type };
            }
        }

        for (const key of wrappers) {
            const inner = node[key]?.message;
            if (inner && typeof inner === 'object') {
                queue.push({
                    node: inner,
                    inViewOnce: inViewOnce || key.startsWith('viewOnceMessage'),
                });
            }
        }
        if (node.message && typeof node.message === 'object') {
            queue.push({ node: node.message, inViewOnce });
        }
    }
    return null;
}

function hasDownloadFields(media) {
    return !!(media && (media.directPath || media.url) && media.mediaKey);
}

async function toBuffer(stream) {
    const chunks = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
}

module.exports = {
    name: 'viewonce',
    aliases: ['vv', 'vv2', 'rvo', 'readvo', 'readviewonce'],
    category: 'owner',
    ownerOnly: true,
    description: 'Reveal view-once messages — .vv → owner DM | .vv2 → current chat',
    usage: '.vv (reply to a view-once) | .vv2 (reply to display here)',

    async execute(sock, msg, args, extra = {}) {
        const chatId = extra.from || msg.key.remoteJid;
        const command = String(extra.command || '').toLowerCase();
        const sendToCurrentChat = command === 'vv2';
        const selfJid = sock.user?.id
            ? `${sock.user.id.split(':')[0].split('@')[0]}@s.whatsapp.net`
            : chatId;
        const targetJid = sendToCurrentChat ? chatId : selfJid;

        try {
            const ctx = getQuotedContext(msg);
            if (!ctx?.quotedMessage || !ctx.stanzaId) {
                return await sock.sendMessage(chatId, {
                    text: '❌ Reply directly to the original view-once image, video, or audio with .vv or .vv2.'
                }, { quoted: msg });
            }

            // First try the quoted payload. Some WhatsApp clients provide only
            // a partial quoted stub, so use the original cached message next.
            let found = findViewOnceMedia(ctx.quotedMessage);
            if (!found || !hasDownloadFields(found.media)) {
                const original = global.getCachedViewOnceMessage?.(ctx.stanzaId);
                if (original?.message) {
                    const cachedFound = findViewOnceMedia(original.message);
                    if (cachedFound && hasDownloadFields(cachedFound.media)) {
                        found = cachedFound;
                    }
                }
            }

            if (!found) {
                throw new Error(
                    'The original media was not available in the bot cache. Send/reply to the view-once after the bot is online, then try .vv again.'
                );
            }
            if (!hasDownloadFields(found.media)) {
                throw new Error(
                    'The quoted media has no directPath/url and mediaKey. WhatsApp did not provide a downloadable original message.'
                );
            }

            const { media, type } = found;
            const kind = type === 'imageMessage' ? 'image'
                : type === 'videoMessage' ? 'video' : 'audio';
            const buffer = await toBuffer(
                await downloadContentFromMessage(media, kind)
            );
            if (!buffer.length) throw new Error('Baileys returned an empty media stream');

            let payload;
            if (type === 'imageMessage') {
                payload = { image: buffer, caption: media.caption || '' };
            } else if (type === 'videoMessage') {
                payload = {
                    video: buffer,
                    caption: media.caption || '',
                    mimetype: media.mimetype || 'video/mp4',
                };
            } else {
                payload = {
                    audio: buffer,
                    mimetype: media.mimetype || 'audio/ogg; codecs=opus',
                    ptt: !!media.ptt,
                };
            }

            await sock.sendMessage(targetJid, payload);
            await sock.sendMessage(chatId, {
                react: { text: '✅', key: msg.key }
            });
        } catch (error) {
            console.error('[VIEWONCE] Failed:', error);
            await sock.sendMessage(chatId, {
                text: `❌ Failed to reveal view-once: ${error.message || 'Unknown error'}`
            }, { quoted: msg });
        }
    }
};
