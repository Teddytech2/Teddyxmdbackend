/**
 * ViewOnce Command
 *   .vv  — reveals a quoted view-once message in the bot owner's DM
 *   .vv2 — reveals a quoted view-once message in the current chat
 *
 * Compatible with Baileys 7 message wrappers, including nested ephemeral and
 * document-with-caption containers. Media is streamed to a temp file so large
 * images/videos do not need to be held entirely in memory.
 */

const fs = require('fs');
const { pipeline } = require('stream/promises');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const { createTempFilePath, deleteTempFile } = require('../../utils/tempManager');

const MEDIA_TYPES = {
    imageMessage: { download: 'image', extension: 'jpg' },
    videoMessage: { download: 'video', extension: 'mp4' },
    audioMessage: { download: 'audio', extension: 'ogg' },
};

// WhatsApp can nest the actual message under one or more of these wrappers.
const MESSAGE_WRAPPERS = [
    'ephemeralMessage',
    'viewOnceMessageV2Extension',
    'viewOnceMessageV2',
    'viewOnceMessage',
    'documentWithCaptionMessage',
    'deviceSentMessage',
];

function findContextInfo(message) {
    if (!message || typeof message !== 'object') return null;
    const queue = [message];
    const seen = new Set();

    while (queue.length) {
        const current = queue.shift();
        if (!current || typeof current !== 'object' || seen.has(current)) continue;
        seen.add(current);

        for (const value of Object.values(current)) {
            if (!value || typeof value !== 'object') continue;
            if (value.contextInfo?.quotedMessage) return value.contextInfo;
            if (value.message && typeof value.message === 'object') queue.push(value.message);
        }
    }
    return null;
}

function extractViewOnceMedia(quotedMessage) {
    if (!quotedMessage || typeof quotedMessage !== 'object') return null;

    const queue = [quotedMessage];
    const seen = new Set();

    while (queue.length) {
        const current = queue.shift();
        if (!current || typeof current !== 'object' || seen.has(current)) continue;
        seen.add(current);

        for (const [key, value] of Object.entries(current)) {
            if (!value || typeof value !== 'object') continue;

            if (MEDIA_TYPES[key] && value.viewOnce) {
                return { type: key, media: { ...value, viewOnce: false } };
            }

            if (MESSAGE_WRAPPERS.includes(key) && value.message) {
                const inner = value.message;
                for (const [mediaType, media] of Object.entries(inner)) {
                    if (MEDIA_TYPES[mediaType] && media && typeof media === 'object') {
                        return { type: mediaType, media: { ...media, viewOnce: false } };
                    }
                }
                queue.push(inner);
            }
        }
    }
    return null;
}

module.exports = {
    name: 'viewonce',
    aliases: ['vv', 'vv2', 'rvo', 'readvo', 'readviewonce'],
    category: 'owner',
    ownerOnly: true,
    description: 'Reveal view-once messages — .vv → owner DM | .vv2 → current chat',
    usage: '.vv (reply to a view-once) | .vv2 (reply to display here)',

    async execute(sock, msg, args, extra = {}) {
        const chatId = extra.from || msg.key?.remoteJid;
        const selfJid = sock.user?.id
            ? `${sock.user.id.split(':')[0].split('@')[0]}@s.whatsapp.net`
            : null;
        const sendToCurrentChat = String(extra.command || '').toLowerCase() === 'vv2';
        const targetJid = sendToCurrentChat ? chatId : selfJid;

        if (!chatId) return;
        if (!targetJid) {
            return sock.sendMessage(chatId, {
                text: '❌ I could not determine the bot account JID. Please reconnect the bot.'
            }, { quoted: msg });
        }

        let tmpPath = null;
        try {
            const contextInfo = findContextInfo(msg.message);
            const quotedMessage = contextInfo?.quotedMessage;

            if (!quotedMessage) {
                return await sock.sendMessage(chatId, {
                    text: sendToCurrentChat
                        ? '🗑️ Reply to a *view-once* message with *.vv2* to reveal it here.'
                        : '🗑️ Reply to a *view-once* message with *.vv* to reveal it in your DM.'
                }, { quoted: msg });
            }

            const found = extractViewOnceMedia(quotedMessage);
            if (!found) {
                return await sock.sendMessage(chatId, {
                    text: '❌ I could not find supported view-once image, video, or audio media in that reply.'
                }, { quoted: msg });
            }

            const mediaConfig = MEDIA_TYPES[found.type];
            tmpPath = createTempFilePath('vv', mediaConfig.extension);
            const downloadStream = await downloadContentFromMessage(found.media, mediaConfig.download);
            const writeStream = fs.createWriteStream(tmpPath);
            await pipeline(downloadStream, writeStream);

            const caption = found.media.caption || '';
            if (found.type === 'imageMessage') {
                await sock.sendMessage(targetJid, {
                    image: { url: tmpPath },
                    caption: caption || '🖼️ *ViewOnce Image*'
                });
            } else if (found.type === 'videoMessage') {
                await sock.sendMessage(targetJid, {
                    video: { url: tmpPath },
                    caption: caption || '🎬 *ViewOnce Video*',
                    mimetype: found.media.mimetype || 'video/mp4'
                });
            } else {
                await sock.sendMessage(targetJid, {
                    audio: { url: tmpPath },
                    mimetype: found.media.mimetype || 'audio/ogg; codecs=opus',
                    ptt: false
                });
            }

            await sock.sendMessage(chatId, {
                react: { text: '✅', key: msg.key }
            });
        } catch (error) {
            console.error('[VIEWONCE] Reveal failed:', error);
            await sock.sendMessage(chatId, {
                text: `❌ Failed to reveal view-once: ${error.message || 'Unknown error'}`
            }, { quoted: msg });
        } finally {
            if (tmpPath) deleteTempFile(tmpPath);
        }
    }
};
