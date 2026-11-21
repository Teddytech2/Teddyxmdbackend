
/**
 * ViewOnce Command - TeddyXMD
 *
 * .vv  - Reveal view-once and send to bot's private DM
 * .vv2 - Reveal view-once and send in current chat
 *
 * Supports:
 * - viewOnceMessage
 * - viewOnceMessageV2
 * - viewOnceMessageV2Extension
 * - ephemeralMessage wrappers
 * - Nested WhatsApp message structures
 * - Image, video and audio
 */

const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');

const {
    downloadContentFromMessage
} = require('@whiskeysockets/baileys');

const {
    createTempFilePath,
    deleteTempFile
} = require('../../utils/tempManager');

const VIEW_ONCE_KEYS = [
    'viewOnceMessage',
    'viewOnceMessageV2',
    'viewOnceMessageV2Extension'
];

const MEDIA_TYPES = [
    'imageMessage',
    'videoMessage',
    'audioMessage'
];

// Find contextInfo even if the message has nested wrappers.
function findContextInfo(obj, depth = 0) {
    if (!obj || typeof obj !== 'object' || depth > 12) {
        return null;
    }

    if (obj.contextInfo?.quotedMessage) {
        return obj.contextInfo;
    }

    for (const value of Object.values(obj)) {
        if (value && typeof value === 'object') {
            const result = findContextInfo(value, depth + 1);
            if (result) return result;
        }
    }

    return null;
}

// Extract media from a message without assuming its wrapper structure.
function extractViewOnce(obj, depth = 0, isViewOnce = false) {
    if (!obj || typeof obj !== 'object' || depth > 15) {
        return null;
    }

    for (const key of VIEW_ONCE_KEYS) {
        if (obj[key]?.message) {
            const result = extractViewOnce(
                obj[key].message,
                depth + 1,
                true
            );

            if (result) return result;
        }
    }

    // Handle ephemeral and other common message wrappers.
    const wrappers = [
        'ephemeralMessage',
        'documentWithCaptionMessage',
        'deviceSentMessage',
        'editedMessage'
    ];

    for (const key of wrappers) {
        if (obj[key]?.message) {
            const result = extractViewOnce(
                obj[key].message,
                depth + 1,
                isViewOnce
            );

            if (result) return result;
        }
    }

    // Handle direct media messages with viewOnce flag.
    for (const type of MEDIA_TYPES) {
        const media = obj[type];

        if (media && (isViewOnce || media.viewOnce === true)) {
            return {
                type,
                media,
                isViewOnce: true
            };
        }
    }

    // Search nested message objects.
    for (const [key, value] of Object.entries(obj)) {
        if (
            value &&
            typeof value === 'object' &&
            !['contextInfo'].includes(key)
        ) {
            const result = extractViewOnce(
                value,
                depth + 1,
                isViewOnce
            );

            if (result) return result;
        }
    }

    return null;
}

function getDownloadType(type) {
    const types = {
        imageMessage: 'image',
        videoMessage: 'video',
        audioMessage: 'audio'
    };

    return types[type] || null;
}

function getExtension(type, mimetype) {
    const mime = (mimetype || '').split(';')[0].toLowerCase();

    const mimeExtensions = {
        'image/jpeg': 'jpg',
        'image/png': 'png',
        'image/webp': 'webp',
        'video/mp4': 'mp4',
        'audio/mp4': 'm4a',
        'audio/mpeg': 'mp3',
        'audio/ogg': 'ogg',
        'audio/opus': 'ogg',
        'audio/aac': 'aac'
    };

    if (mimeExtensions[mime]) {
        return mimeExtensions[mime];
    }

    return {
        imageMessage: 'jpg',
        videoMessage: 'mp4',
        audioMessage: 'm4a'
    }[type] || 'bin';
}

module.exports = {
    name: 'viewonce',

    aliases: [
        'vv',
        'vv2',
        'rvo',
        'readvo',
        'readviewonce'
    ],

    category: 'owner',
    ownerOnly: true,

    description: 'Reveal view-once messages',

    usage: '.vv (reply to view-once) | .vv2 (reply to view-once)',

    async execute(sock, msg, args, extra) {
        const chatId = extra.from;

        const selfJid = sock.user.id
            .split(':')[0]
            .replace(/[^0-9]/g, '') + '@s.whatsapp.net';

        const command = (extra.command || '')
            .toLowerCase()
            .replace(/^\./, '');

        const sendToCurrentChat = command === 'vv2';

        const targetJid = sendToCurrentChat
            ? chatId
            : selfJid;

        let tmpPath = null;

        try {
            // 1. Find quoted message context.
            const ctx = findContextInfo(msg.message);

            if (!ctx || !ctx.quotedMessage) {
                return await sock.sendMessage(chatId, {
                    text: sendToCurrentChat
                        ? '🗑️ Reply directly to a view-once message using *.vv2*.'
                        : '🗑️ Reply directly to a view-once message using *.vv*.'
                }, {
                    quoted: msg
                });
            }

            // 2. Extract quoted message.
            const quoted = ctx.quotedMessage;

            // 3. Detect and unwrap view-once media.
            const extracted = extractViewOnce(quoted);

            if (!extracted || !extracted.isViewOnce) {
                return await sock.sendMessage(chatId, {
                    text: '❌ No view-once media detected.\n\nMake sure you are replying directly to the original view-once message.'
                }, {
                    quoted: msg
                });
            }

            const { type, media } = extracted;

            const downloadType = getDownloadType(type);

            if (!downloadType) {
                return await sock.sendMessage(chatId, {
                    text: '❌ Unsupported view-once media type.'
                }, {
                    quoted: msg
                });
            }

            // 4. Check media download information.
            if (!media || (!media.url && !media.directPath)) {
                return await sock.sendMessage(chatId, {
                    text: '❌ View-once media was detected, but WhatsApp did not provide a valid media URL or directPath.\n\nTry replying to the original message again.'
                }, {
                    quoted: msg
                });
            }

            // 5. Download the media as a stream.
            const ext = getExtension(type, media.mimetype);

            tmpPath = createTempFilePath('vv', ext);

            const downloadStream = await downloadContentFromMessage(
                media,
                downloadType
            );

            if (!downloadStream) {
                throw new Error('Baileys returned an empty download stream.');
            }

            await pipeline(
                downloadStream,
                fs.createWriteStream(tmpPath)
            );

            // 6. Verify downloaded file.
            if (
                !fs.existsSync(tmpPath) ||
                fs.statSync(tmpPath).size === 0
            ) {
                throw new Error('Downloaded media file is empty.');
            }

            // 7. Prepare caption.
            const caption = media.caption || '';

            const mimetype = media.mimetype ||
                (type === 'imageMessage'
                    ? 'image/jpeg'
                    : type === 'videoMessage'
                        ? 'video/mp4'
                        : 'audio/mp4');

            // 8. Send revealed media.
            if (type === 'imageMessage') {
                await sock.sendMessage(targetJid, {
                    image: {
                        url: tmpPath
                    },
                    mimetype,
                    caption: caption || '🖼️ *Revealed ViewOnce Image*'
                });

            } else if (type === 'videoMessage') {
                await sock.sendMessage(targetJid, {
                    video: {
                        url: tmpPath
                    },
                    mimetype,
                    caption: caption || '🎬 *Revealed ViewOnce Video*'
                });

            } else if (type === 'audioMessage') {
                await sock.sendMessage(targetJid, {
                    audio: {
                        url: tmpPath
                    },
                    mimetype,
                    ptt: media.ptt || false
                });
            }

            // 9. React to original command.
            await sock.sendMessage(chatId, {
                react: {
                    text: '✅',
                    key: msg.key
                }
            });

        } catch (error) {
            console.error('[VIEWONCE ERROR]', error);

            await sock.sendMessage(chatId, {
                text:
                    '❌ *Failed to reveal view-once*\n\n' +
                    `Error: ${error.message || 'Unknown error'}`
            }, {
                quoted: msg
            });

        } finally {
            // 10. Always remove temporary file.
            if (tmpPath) {
                try {
                    if (fs.existsSync(tmpPath)) {
                        await deleteTempFile(tmpPath);
                    }
                } catch (cleanupError) {
                    console.error(
                        '[VIEWONCE CLEANUP ERROR]',
                        cleanupError
                    );
                }
            }
        }
    }
};
