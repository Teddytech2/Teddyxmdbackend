/**
 * ViewOnce Command — Levanter-style reveal/forward.
 *
 * .vv  reveals the replied-to view-once message in the current chat.
 * .vv2 reveals it in the bot owner's private chat.
 *
 * Uses the original Baileys message payload/key and relays the unwrapped
 * media with viewOnce disabled, matching Levanter's forwardOrBroadCast()
 * approach. No media download/temp-file round trip is required.
 */
const { generateMessageIDV2, downloadContentFromMessage } = require('@whiskeysockets/baileys');

const VIEW_ONCE_WRAPPERS = [
    'viewOnceMessageV2Extension',
    'viewOnceMessageV2',
    'viewOnceMessage',
];
const MEDIA_TYPES = ['imageMessage', 'videoMessage', 'audioMessage'];

async function sendMediaFallback(sock, targetJid, extracted) {
    const { type, media } = extracted;
    const downloadType = type === 'imageMessage' ? 'image' : type === 'videoMessage' ? 'video' : 'audio';
    const stream = await downloadContentFromMessage(media, downloadType);
    const chunks = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    const buffer = Buffer.concat(chunks);
    if (!buffer.length) throw new Error('Downloaded View Once media was empty');

    if (type === 'imageMessage') {
        return sock.sendMessage(targetJid, { image: buffer, caption: media.caption || '🖼️ *View Once Image*', ...(media.mimetype ? { mimetype: media.mimetype } : {}) });
    }
    if (type === 'videoMessage') {
        return sock.sendMessage(targetJid, { video: buffer, caption: media.caption || '🎬 *View Once Video*', mimetype: media.mimetype || 'video/mp4' });
    }
    return sock.sendMessage(targetJid, { audio: buffer, mimetype: media.mimetype || 'audio/ogg; codecs=opus', ptt: !!media.ptt });
}

function unwrapViewOnce(content) {
    let current = content;
    let foundViewOnce = false;

    // WhatsApp may nest ephemeral/document wrappers around view-once.
    for (let depth = 0; depth < 12 && current && typeof current === 'object'; depth++) {
        let next = null;

        for (const wrapper of VIEW_ONCE_WRAPPERS) {
            if (current[wrapper]?.message) {
                foundViewOnce = true;
                next = current[wrapper].message;
                break;
            }
        }

        if (!next && current.ephemeralMessage?.message) {
            next = current.ephemeralMessage.message;
        }
        if (!next && current.documentWithCaptionMessage?.message) {
            next = current.documentWithCaptionMessage.message;
        }

        if (!next) break;
        current = next;
    }

    if (!current || typeof current !== 'object') return null;

    // Support direct viewOnce flags as well as wrapped messages.
    const type = MEDIA_TYPES.find((key) => current[key]);
    if (!type) return null;

    const media = current[type];
    if (media?.viewOnce) foundViewOnce = true;
    if (!foundViewOnce) return null;

    // Clone the content and remove the one-time flag before relaying.
    const revealed = { ...current, [type]: { ...media, viewOnce: false } };
    return { content: revealed, type, media: revealed[type] };
}

module.exports = {
    name: 'viewonce',
    aliases: ['vv', 'vv2', 'rvo', 'readvo', 'readviewonce'],
    category: 'owner',
    ownerOnly: true,
    description: 'Reveal view-once messages — .vv sends in the current chat, .vv2 sends to your DM',
    usage: '.vv (reply, sends in chat) or .vv2 (reply, sends to your DM)',

    async execute(sock, msg, args, extra) {
        const chatId = extra.from;
        const command = String(extra.command || '').toLowerCase();
        const sendToCurrentChat = command === 'vv';
        const selfJid = `${sock.user.id.split(':')[0].split('@')[0]}@s.whatsapp.net`;
        const targetJid = sendToCurrentChat ? chatId : selfJid;

        try {
            // The quoted message's stanza ID is the key used by the handler cache.
            const ctx = msg.message?.extendedTextMessage?.contextInfo
                || msg.message?.imageMessage?.contextInfo
                || msg.message?.videoMessage?.contextInfo
                || msg.message?.documentMessage?.contextInfo;

            if (!ctx?.quotedMessage) {
                return await sock.sendMessage(chatId, {
                    text: `📥 Reply to a View Once message using *.${sendToCurrentChat ? 'vv' : 'vv2'}*.`,
                }, { quoted: msg });
            }

            const originalId = ctx.stanzaId;
            let original = originalId && global.viewOnceCache instanceof Map
                ? global.viewOnceCache.get(String(originalId))
                : null;

            // A stored original preserves the complete Baileys key, which is
            // needed by relay/reupload logic for LID and group messages.
            if (!original && originalId && sock.botStore?.loadMessage) {
                const candidates = [...new Set([
                    ctx.remoteJid,
                    ctx.remoteJidAlt,
                    chatId,
                ].filter(Boolean))];

                for (const jid of candidates) {
                    try {
                        original = await sock.botStore.loadMessage(jid, String(originalId));
                        if (original) break;
                    } catch (_) {}
                }
            }

            const source = original?.message || ctx.quotedMessage;
            const extracted = unwrapViewOnce(source);
            if (!extracted) {
                return await sock.sendMessage(chatId, {
                    text: '❌ I could not find a supported View Once image, video, or audio in that reply.',
                }, { quoted: msg });
            }

            const { content } = extracted;
            const messageId = typeof generateMessageIDV2 === 'function'
                ? generateMessageIDV2(sock.user.id)
                : undefined;

            // Relay the actual unwrapped Baileys message instead of downloading
            // it to a temporary file and re-uploading a second copy.
            try {
                await sock.relayMessage(targetJid, content, {
                    ...(messageId ? { messageId } : {}),
                    additionalAttributes: {},
                });
            } catch (relayError) {
                // Levanter-style relay is the primary path. If Baileys rejects
                // the original payload/key, re-upload the media to the SAME
                // destination (especially the owner's inbox for .vv2).
                console.warn('[VIEWONCE RELAY FALLBACK]', relayError?.message || relayError);
                await sendMediaFallback(sock, targetJid, extracted);
            }

            await sock.sendMessage(chatId, {
                react: { text: '✅', key: msg.key },
            });

            if (!sendToCurrentChat) {
                await sock.sendMessage(chatId, {
                    text: '✅ View Once media sent to your DM.',
                }, { quoted: msg });
            }
        } catch (error) {
            console.error('[VIEWONCE ERROR]', error);
            await sock.sendMessage(chatId, {
                text: `❌ Failed to reveal View Once media${sendToCurrentChat ? ' in this chat' : ' to the owner inbox'}.\n\nDetails: ${error.message || 'Unknown error'}`,
            }, { quoted: msg });
        }
    },
};
