/**
 * ViewOnce Reveal Command
 * .vv  -> reveal to the bot's private chat
 * .vv2 -> reveal in the current chat
 *
 * Uses Baileys downloadContentFromMessage directly, then sends the
 * downloaded Buffer as media. Compatible with this project's command loader.
 */
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');

const MEDIA_TYPES = {
    imageMessage: 'image',
    videoMessage: 'video',
    audioMessage: 'audio'
};

const WRAPPER_KEYS = [
    'ephemeralMessage',
    'viewOnceMessageV2Extension',
    'viewOnceMessageV2',
    'viewOnceMessage',
    'documentWithCaptionMessage',
    'deviceSentMessage'
];

/** Walk Baileys wrappers until a real media payload is found. */
function findMedia(node, depth = 0) {
    if (!node || typeof node !== 'object' || depth > 8) return null;

    // Do not use Object.keys()[0]: protocol metadata can come first.
    for (const [messageType, downloadType] of Object.entries(MEDIA_TYPES)) {
        const candidate = node[messageType];
        if (candidate && typeof candidate === 'object') {
            return { messageType, downloadType, mediaMessage: candidate };
        }
    }

    for (const wrapperKey of WRAPPER_KEYS) {
        const wrapped = node[wrapperKey];
        if (wrapped?.message) {
            const found = findMedia(wrapped.message, depth + 1);
            if (found) return found;
        }
    }

    if (node.message && typeof node.message === 'object') {
        return findMedia(node.message, depth + 1);
    }
    return null;
}

function findQuotedContext(message, depth = 0) {
    if (!message || typeof message !== 'object' || depth > 8) return null;

    const context =
        message.extendedTextMessage?.contextInfo ||
        message.imageMessage?.contextInfo ||
        message.videoMessage?.contextInfo ||
        message.audioMessage?.contextInfo ||
        message.stickerMessage?.contextInfo ||
        message.documentMessage?.contextInfo ||
        message.buttonsResponseMessage?.contextInfo ||
        message.listResponseMessage?.contextInfo;

    if (context?.quotedMessage) return context;

    for (const wrapperKey of WRAPPER_KEYS) {
        const wrapped = message[wrapperKey];
        if (wrapped?.message) {
            const found = findQuotedContext(wrapped.message, depth + 1);
            if (found) return found;
        }
    }
    return null;
}

module.exports = {
    name: 'viewonce',
    aliases: ['vv', 'vv2', 'rvo', 'readvo', 'readviewonce'],
    category: 'owner',
    ownerOnly: true,
    description: 'Reveal view-once image, video or audio — .vv sends to bot DM; .vv2 sends here',
    usage: '.vv (reply to view-once media) | .vv2 (reply to display here)',

    async execute(conn, mek, args, extra) {
        const from = extra.from;
        const isVv2 = String(extra.command || '').toLowerCase() === 'vv2';
        const ownerJid = conn.user?.id
            ? conn.user.id.split(':')[0].split('@')[0] + '@s.whatsapp.net'
            : null;
        const targetJid = isVv2 ? from : ownerJid;

        if (!targetJid) {
            return conn.sendMessage(from, {
                text: '❌ Could not determine the bot private chat destination.'
            }, { quoted: mek });
        }

        try {
            const context = findQuotedContext(mek.message);
            const quoted = context?.quotedMessage;

            if (!quoted) {
                return conn.sendMessage(from, {
                    text: '❌ Reply to a *view-once image, video or audio*.'
                }, { quoted: mek });
            }

            const found = findMedia(quoted);
            if (!found) {
                return conn.sendMessage(from, {
                    text: '❌ The quoted message does not contain supported image, video or audio media.'
                }, { quoted: mek });
            }

            const { messageType, downloadType, mediaMessage } = found;
            if (!mediaMessage.mediaKey || (!mediaMessage.url && !mediaMessage.directPath)) {
                console.error('[VV] Quoted media payload incomplete', {
                    messageType,
                    hasMediaKey: !!mediaMessage.mediaKey,
                    hasUrl: !!mediaMessage.url,
                    hasDirectPath: !!mediaMessage.directPath,
                    quotedKeys: Object.keys(quoted || {})
                });
                return conn.sendMessage(from, {
                    text: '❌ WhatsApp quoted this message without the media download data. Please quote the original view-once message again.'
                }, { quoted: mek });
            }

            const stream = await downloadContentFromMessage(mediaMessage, downloadType);
            const chunks = [];
            for await (const chunk of stream) chunks.push(Buffer.from(chunk));
            const buffer = Buffer.concat(chunks);
            if (!buffer.length) throw new Error('WhatsApp returned an empty media stream.');

            const sendData = {
                caption: mediaMessage.caption || '',
                contextInfo: {
                    mentionedJid: extra.sender ? [extra.sender] : [],
                    forwardingScore: 999,
                    isForwarded: true
                }
            };

            if (messageType === 'imageMessage') {
                sendData.image = buffer;
            } else if (messageType === 'videoMessage') {
                sendData.video = buffer;
            } else {
                sendData.audio = buffer;
                sendData.mimetype = mediaMessage.mimetype || 'audio/mp4';
                sendData.ptt = false;
            }

            await conn.sendMessage(targetJid, sendData, { quoted: mek });
            await conn.sendMessage(from, {
                react: { text: '👁️', key: mek.key }
            });
        } catch (error) {
            console.error('[VV] Command error:', error);
            await conn.sendMessage(from, {
                text: `❌ Failed to reveal view-once media: ${error.message || 'Unknown error'}`
            }, { quoted: mek });
        }
    }
};
