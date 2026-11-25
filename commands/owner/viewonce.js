
/**
 * ViewOnce Command (Ghost routing)
 * .vv  — reveals view-once and sends in the current chat
 * .vv2 — reveals view-once and sends to the commander's inbox (owner DM)
 *
 * Supports:
 * - viewOnceMessage
 * - viewOnceMessageV2
 * - viewOnceMessageV2Extension
 * - Image, video and audio
 *
 * Source order for the original message:
 * 1. handler.js viewOnceCache (fresh, unviewed view-onces)
 * 2. message store (sock.botStore) — covers VIEWED/stub view-onces,
 *    whose mediaKey survives in the stored message
 * 3. quoted payload from contextInfo (last resort)
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

    description: 'Reveal view-once messages — .vv sends in the current chat, .vv2 sends to your DM',
    usage: '.vv (reply, sends in chat) or .vv2 (reply, sends to your DM)',

    async execute(sock, msg, args, extra) {
        const chatId = extra.from;

        const selfJid =
            sock.user.id.split(':')[0].split('@')[0] +
            '@s.whatsapp.net';

        const sendToCurrentChat = extra.command === 'vv';

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
                        ? '📥 Reply to a View Once message using *.vv*.'
                        : '📥 Reply to a View Once message using *.vv2*.'
                }, { quoted: msg });
            }

            // Prefer the complete original message captured by handler.js.
            // Quoted contextInfo contains the quoted payload but not the full
            // Baileys message key required for reliable media re-upload.
            const originalMessageId = ctx.stanzaId;
            let cachedOriginal = originalMessageId && global.viewOnceCache instanceof Map
                ? global.viewOnceCache.get(String(originalMessageId))
                : null;

            // Store fallback (Ghost-style): the handler cache only holds
            // FRESH (unviewed) view-onces. For a VIEWED/stub view-once the
            // cache misses, but the message store keeps the original
            // message (with its mediaKey), so download it from there.
            // Mirrors the socket getMessage LID fallback in index.js.
            if (!cachedOriginal && originalMessageId && sock.botStore?.loadMessage) {
                try {
                    const storeJids = [...new Set([ctx.remoteJid, ctx.remoteJidAlt, chatId].filter(Boolean))];
                    for (const jid of storeJids) {
                        const stored = await sock.botStore.loadMessage(jid, String(originalMessageId));
                        if (stored) { cachedOriginal = stored; break; }
                    }
                } catch (_) { /* store miss — fall through to quoted payload */ }
            }

            const quotedPayload = cachedOriginal?.message || ctx.quotedMessage;

            // Extract the actual media from the original message when cached.
            const extracted = extractMedia(quotedPayload);

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

            // Use the exact original Baileys key whenever the handler cache
            // has it. This preserves remoteJid/fromMe/participant and avoids
            // guessing those fields from the reply's contextInfo.
            const quotedKey = cachedOriginal?.key || {
                remoteJid: ctx.remoteJid || chatId,
                fromMe: Boolean(ctx.participant && ctx.participant === selfJid),
                id: ctx.stanzaId,
                ...(ctx.participant ? { participant: ctx.participant } : {})
            };

            // Match the known-working bot implementation exactly: let
            // downloadMediaMessage handle media re-upload when the quoted
            // payload has no directPath/url. Do not reject it here; Baileys
            // can use mediaKey plus updateMediaMessage to request a fresh URL.
            // Keep the original message key and unwrapped media payload intact.
            const mediaStream = await downloadMediaMessage(
                { key: quotedKey, message },
                'stream',
                {},
                {
                    logger: console,
                    reuploadRequest: (key) => sock.updateMediaMessage(key)
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
