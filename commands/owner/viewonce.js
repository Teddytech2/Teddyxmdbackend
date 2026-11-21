/**
 * ViewOnce Command - TeddyXMD
 * .vv  - Reveal view-once (if WhatsApp provides it)
 * .vv2 - Reveal in current chat
 */

const fs = require('fs');
const { pipeline } = require('stream/promises');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const { createTempFilePath, deleteTempFile } = require('../../utils/tempManager');

const VIEW_ONCE_KEYS = [
    'viewOnceMessage',
    'viewOnceMessageV2',
    'viewOnceMessageV2Extension'
];

const MEDIA_TYPES = ['imageMessage', 'videoMessage', 'audioMessage'];

function findContextInfo(obj, depth = 0) {
    if (!obj || typeof obj !== 'object' || depth > 12) return null;
    if (obj.contextInfo?.quotedMessage) return obj.contextInfo;
    for (const value of Object.values(obj)) {
        if (value && typeof value === 'object') {
            const result = findContextInfo(value, depth + 1);
            if (result) return result;
        }
    }
    return null;
}

function extractViewOnce(obj, depth = 0, isViewOnce = false) {
    if (!obj || typeof obj !== 'object' || depth > 15) return null;

    for (const key of VIEW_ONCE_KEYS) {
        if (obj[key]?.message) {
            const result = extractViewOnce(obj[key].message, depth + 1, true);
            if (result) return result;
        }
    }

    const wrappers = ['ephemeralMessage', 'documentWithCaptionMessage', 'deviceSentMessage', 'editedMessage'];
    for (const key of wrappers) {
        if (obj[key]?.message) {
            const result = extractViewOnce(obj[key].message, depth + 1, isViewOnce);
            if (result) return result;
        }
    }

    for (const type of MEDIA_TYPES) {
        const media = obj[type];
        if (media && (isViewOnce || media.viewOnce === true)) {
            return { type, media, isViewOnce: true };
        }
    }

    for (const [key, value] of Object.entries(obj)) {
        if (value && typeof value === 'object' && key !== 'contextInfo') {
            const result = extractViewOnce(value, depth + 1, isViewOnce);
            if (result) return result;
        }
    }
    return null;
}

function getDownloadType(type) {
    return { imageMessage: 'image', videoMessage: 'video', audioMessage: 'audio' }[type] || null;
}

function getExtension(type, mimetype) {
    const mime = (mimetype || '').split(';')[0].toLowerCase();
    const map = {
        'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
        'video/mp4': 'mp4', 'audio/mp4': 'm4a', 'audio/mpeg': 'mp3',
        'audio/ogg': 'ogg', 'audio/opus': 'ogg', 'audio/aac': 'aac'
    };
    if (map[mime]) return map[mime];
    return { imageMessage: 'jpg', videoMessage: 'mp4', audioMessage: 'm4a' }[type] || 'bin';
}

module.exports = {
    name: 'viewonce',
    aliases: ['vv', 'vv2', 'rvo', 'readvo', 'readviewonce'],
    category: 'owner',
    ownerOnly: true,
    description: 'Reveal view-once messages',
    usage: '.vv (reply to view-once) | .vv2 (reply to view-once)',

    async execute(sock, msg, args, extra) {
        const chatId = extra.from;

        // Safer selfJid
        const selfJid = sock.user?.id ? sock.user.id.split(':')[0].replace(/[^0-9]/g, '') + '@s.whatsapp.net' : chatId;

        const command = (extra.command || '').toLowerCase().replace(/^\./, '');
        const sendToCurrentChat = command === 'vv2';
        const targetJid = sendToCurrentChat ? chatId : selfJid;

        let tmpPath = null;

        try {
            const ctx = findContextInfo(msg.message);

            if (!ctx || !ctx.quotedMessage) {
                return await sock.sendMessage(chatId, {
                    text: sendToCurrentChat
                        ? '🗑️ Reply directly to a view-once message using *.vv2*.'
                        : '🗑️ Reply directly to a view-once message using *.vv*.'
                }, { quoted: msg });
            }

            const extracted = extractViewOnce(ctx.quotedMessage);

            if (!extracted || !extracted.isViewOnce) {
                return await sock.sendMessage(chatId, {
                    text: '❌ No view-once media detected.\n\nMake sure you are replying directly to the original view-once message.'
                }, { quoted: msg });
            }

            const { type, media } = extracted;
            const downloadType = getDownloadType(type);

            if (!downloadType) {
                return await sock.sendMessage(chatId, {
                    text: '❌ Unsupported view-once media type.'
                }, { quoted: msg });
            }

            // --- FIXED ERROR MESSAGE HERE ---
            if (!media || (!media.url && !media.directPath)) {
                return await sock.sendMessage(chatId, {
                    text: '❌ *Can\'t reveal this view-once*\n\n' +
                          'WhatsApp did not include a download link in this quoted message.\n' +
                          'This happens even if you reply before opening it — WhatsApp strips the link on purpose for view-once replies.\n\n' +
                          'Ask the sender to resend it as a normal photo/video.'
                }, { quoted: msg });
            }

            const ext = getExtension(type, media.mimetype);
            tmpPath = createTempFilePath('vv', ext);

            const downloadStream = await downloadContentFromMessage(media, downloadType);
            if (!downloadStream) throw new Error('Baileys returned an empty download stream.');

            await pipeline(downloadStream, fs.createWriteStream(tmpPath));

            if (!fs.existsSync(tmpPath) || fs.statSync(tmpPath).size === 0) {
                throw new Error('Downloaded media file is empty.');
            }

            const caption = media.caption || '';
            const mimetype = media.mimetype || (type === 'imageMessage' ? 'image/jpeg' : type === 'videoMessage' ? 'video/mp4' : 'audio/mp4');

            if (type === 'imageMessage') {
                await sock.sendMessage(targetJid, { image: { url: tmpPath }, mimetype, caption: caption || '🖼️ *Revealed ViewOnce Image*' });
            } else if (type === 'videoMessage') {
                await sock.sendMessage(targetJid, { video: { url: tmpPath }, mimetype, caption: caption || '🎬 *Revealed ViewOnce Video*' });
            } else if (type === 'audioMessage') {
                await sock.sendMessage(targetJid, { audio: { url: tmpPath }, mimetype, ptt: media.ptt || false });
            }

            await sock.sendMessage(chatId, { react: { text: '✅', key: msg.key } });

        } catch (error) {
            console.error('[VIEWONCE ERROR]', error);
            await sock.sendMessage(chatId, {
                text: '❌ *Failed to reveal view-once*\n\n' + `Error: ${error.message || 'Unknown error'}`
            }, { quoted: msg });
        } finally {
            if (tmpPath) {
                try { if (fs.existsSync(tmpPath)) await deleteTempFile(tmpPath); }
                catch (e) { console.error('[VIEWONCE CLEANUP ERROR]', e); }
            }
        }
    }
};
