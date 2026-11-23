
/**
 * ViewOnce Command
 * .vv  — reveals view-once and sends to bot owner's DM
 * .vv2 — reveals view-once and sends in the current chat
 *
 * Supports:
 * - viewOnceMessage
 * - viewOnceMessageV2
 * - viewOnceMessageV2Extension
 * - Image, video and audio
 */

const fs = require('fs');
const { pipeline } = require('stream/promises');
const {
    downloadMediaMessage
} = require('@whiskeysockets/baileys');

const {
    createTempFilePath,
    deleteTempFile
} = require('../../utils/tempManager');

function findQuotedContext(content) {
    const stack = [content];
    const visited = new Set();

    while (stack.length) {
        const current = stack.pop();

        if (!current || typeof current !== 'object' || visited.has(current)) {
            continue;
        }

        visited.add(current);

        if (current.contextInfo?.quotedMessage) {
            return current.contextInfo;
        }

        for (const value of Object.values(current)) {
            if (value && typeof value === 'object') {
                stack.push(value);
            }
        }
    }

    return null;
}

function extractMedia(quoted) {
    let current = quoted;
    let isViewOnce = false;

    // Unwrap nested WhatsApp message containers.
    for (let i = 0; i < 10 && current; i++) {
        if (current.viewOnceMessage?.message) {
            isViewOnce = true;
            current = current.viewOnceMessage.message;
            continue;
        }

        if (current.viewOnceMessageV2?.message) {
            isViewOnce = true;
            current = current.viewOnceMessageV2.message;
            continue;
        }

        if (current.viewOnceMessageV2Extension?.message) {
            isViewOnce = true;
            current = current.viewOnceMessageV2Extension.message;
            continue;
        }

        if (current.ephemeralMessage?.message) {
            current = current.ephemeralMessage.message;
            continue;
        }

        if (current.documentWithCaptionMessage?.message) {
            current = current.documentWithCaptionMessage.message;
            continue;
        }

        break;
    }

    const types = [
        'imageMessage',
        'videoMessage',
        'audioMessage'
    ];

    for (const type of types) {
        if (current?.[type]) {
            const media = current[type];

            if (media.viewOnce) {
                isViewOnce = true;
            }

            if (isViewOnce) {
                return {
                    message: current,
                    type,
                    media
                };
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

    description: 'Reveal view-once messages',
    usage: '.vv or .vv2 (reply to a view-once message)',

    async execute(sock, msg, args, extra) {
        const chatId = extra.from;

        const selfJid =
            sock.user.id.split(':')[0].split('@')[0] +
            '@s.whatsapp.net';

        const sendToCurrentChat = extra.command === 'vv2';

        const targetJid = sendToCurrentChat
            ? chatId
            : selfJid;

        let tmpPath = null;

        try {
            // Find quoted message context.
            const ctx = findQuotedContext(msg.message);

            if (!ctx?.quotedMessage) {
                return await sock.sendMessage(chatId, {
                    text: sendToCurrentChat
                        ? '📥 Reply to a View Once message using *.vv2*.'
                        : '📥 Reply to a View Once message using *.vv*.'
                }, { quoted: msg });
            }

            // Extract the actual media.
            const extracted = extractMedia(ctx.quotedMessage);

            if (!extracted) {
                return await sock.sendMessage(chatId, {
                    text: '❌ That message is not a supported View Once image, video, or audio.'
                }, { quoted: msg });
            }

            const { message, type, media } = extracted;

            const downloadType = {
                imageMessage: 'image',
                videoMessage: 'video',
                audioMessage: 'audio'
            }[type];

            const extension = {
                imageMessage: 'jpg',
                videoMessage: 'mp4',
                audioMessage: 'mp4'
            }[type];

            await sock.sendMessage(chatId, {
                text: '⏳ Processing View Once media...'
            }, { quoted: msg });

            // Reconstruct the original quoted message key.
            const quotedKey = {
                remoteJid: ctx.remoteJid || chatId,
                fromMe: Boolean(
                    ctx.participant &&
                    ctx.participant === selfJid
                ),
                id: ctx.stanzaId
            };

            if (ctx.participant) {
                quotedKey.participant = ctx.participant;
            }

            // Download using the complete media message and original key.
            const mediaStream = await downloadMediaMessage(
                {
                    key: quotedKey,
                    message
                },
                'stream',
                {},
                {
                    logger: console,
                    reuploadRequest: sock.updateMediaMessage
                }
            );

            if (!mediaStream) {
                throw new Error('Media download returned an empty stream.');
            }

            // Save to a temporary file.
            tmpPath = createTempFilePath('vv', extension);

            const writeStream = fs.createWriteStream(tmpPath);

            await pipeline(mediaStream, writeStream);

            if (!fs.existsSync(tmpPath) || fs.statSync(tmpPath).size === 0) {
                throw new Error('Downloaded media is empty.');
            }

            // Preserve the original caption.
            const caption = media.caption || '';

            // Send recovered media.
            if (type === 'imageMessage') {
                await sock.sendMessage(targetJid, {
                    image: { url: tmpPath },
                    caption: caption || '👁️ View Once Image Saved'
                });

            } else if (type === 'videoMessage') {
                await sock.sendMessage(targetJid, {
                    video: { url: tmpPath },
                    caption: caption || '👁️ View Once Video Saved',
                    mimetype: media.mimetype || 'video/mp4'
                });

            } else if (type === 'audioMessage') {
                await sock.sendMessage(targetJid, {
                    audio: { url: tmpPath },
                    mimetype: media.mimetype || 'audio/mp4',
                    ptt: Boolean(media.ptt)
                });
            }

            // React to the original command.
            await sock.sendMessage(chatId, {
                react: {
                    text: '✅',
                    key: msg.key
                }
            });

            // Confirm successful delivery.
            if (!sendToCurrentChat) {
                await sock.sendMessage(chatId, {
                    text: '✅ View Once media sent to your DM.'
                }, { quoted: msg });
            }

        } catch (error) {
            console.error('[VIEWONCE ERROR]', error);

            let errorMessage = '❌ Failed to reveal View Once media.';

            if (/decrypt|media key/i.test(error.message || '')) {
                errorMessage =
                    '❌ Media decryption failed. The media key may be invalid or expired.';
            } else if (/expired|not found/i.test(error.message || '')) {
                errorMessage =
                    '❌ Media may have expired or is no longer available.';
            }

            await sock.sendMessage(chatId, {
                text: `${errorMessage}\n\nDetails: ${error.message || 'Unknown error'}`
            }, { quoted: msg });

        } finally {
            // Always remove temporary files.
            if (tmpPath) {
                try {
                    await deleteTempFile(tmpPath);
                } catch (cleanupError) {
                    console.error('[VV CLEANUP ERROR]', cleanupError);
                }
            }
        }
    }
};
