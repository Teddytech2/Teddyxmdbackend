/**
 * ViewOnce Command
 * .vv  - reveal to the bot owner's private chat
 * .vv2 - reveal in the current chat
 *
 * Uses Baileys' downloadContentFromMessage stream and a Buffer, matching
 * the simple, reliable download/send flow used by the working reference.
 */

const { downloadContentFromMessage } = require('@whiskeysockets/baileys');

function getQuotedMessage(msg) {
    const message = msg.message || {};
    const contexts = [
        message.extendedTextMessage?.contextInfo,
        message.imageMessage?.contextInfo,
        message.videoMessage?.contextInfo,
        message.stickerMessage?.contextInfo,
        message.buttonsResponseMessage?.contextInfo,
        message.listResponseMessage?.contextInfo,
        message.templateButtonReplyMessage?.contextInfo,
        message.interactiveResponseMessage?.contextInfo,
    ];
    const context = contexts.find(item => item?.quotedMessage);
    return context?.quotedMessage || null;
}

// WhatsApp can wrap the media in view-once, ephemeral, or caption wrappers.
// Walk only known message-container fields; don't mistake arbitrary metadata
// keys (e.g. messageContextInfo) for the actual media type.
function findViewOnceMedia(root) {
    const wrapperKeys = [
        'viewOnceMessageV2',
        'viewOnceMessageV2Extension',
        'viewOnceMessage',
        'ephemeralMessage',
        'documentWithCaptionMessage',
        'deviceSentMessage',
    ];
    const mediaTypes = ['imageMessage', 'videoMessage', 'audioMessage'];
    const queue = [{ node: root, insideViewOnce: false }];
    const seen = new Set();

    while (queue.length) {
        const { node, insideViewOnce } = queue.shift();
        if (!node || typeof node !== 'object' || seen.has(node)) continue;
        seen.add(node);

        for (const type of mediaTypes) {
            const media = node[type];
            if (media && (insideViewOnce || media.viewOnce)) {
                return { media, type };
            }
        }

        for (const key of wrapperKeys) {
            const wrapper = node[key];
            const wrapped = wrapper?.message;
            if (wrapped && typeof wrapped === 'object') {
                const isViewOnceWrapper = key.startsWith('viewOnceMessage');
                queue.push({
                    node: wrapped,
                    insideViewOnce: insideViewOnce || isViewOnceWrapper,
                });
            }
        }
        if (node.message && typeof node.message === 'object') {
            queue.push({ node: node.message, insideViewOnce });
        }
    }
    return null;
}

async function streamToBuffer(stream) {
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
        const command = String(extra.command || 'vv').toLowerCase();
        const sendToCurrentChat = command === 'vv2';
        const selfJid = sock.user?.id
            ? `${sock.user.id.split(':')[0].split('@')[0]}@s.whatsapp.net`
            : chatId;
        const targetJid = sendToCurrentChat ? chatId : selfJid;

        try {
            const quoted = getQuotedMessage(msg);
            if (!quoted) {
                return await sock.sendMessage(chatId, {
                    text: sendToCurrentChat
                        ? '🗑️ Reply to a *view-once* message with *.vv2* to reveal it here.'
                        : '🗑️ Reply to a *view-once* message with *.vv* to reveal it in your DM.'
                }, { quoted: msg });
            }

            const found = findViewOnceMedia(quoted);
            if (!found) {
                return await sock.sendMessage(chatId, {
                    text: '❌ Please reply directly to a view-once image, video, or audio message.'
                }, { quoted: msg });
            }

            const { media, type } = found;
            const downloadType = type === 'imageMessage' ? 'image'
                : type === 'videoMessage' ? 'video' : 'audio';
            const buffer = await streamToBuffer(
                await downloadContentFromMessage(media, downloadType)
            );

            if (!buffer.length) throw new Error('Baileys returned an empty media stream');

            const caption = media.caption || '';
            let payload;
            if (type === 'imageMessage') {
                payload = { image: buffer, caption };
            } else if (type === 'videoMessage') {
                payload = { video: buffer, caption, mimetype: media.mimetype || 'video/mp4' };
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
