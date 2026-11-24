
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

function hasDownloadLocator(media) {
    return Boolean(media?.url || media?.directPath);
}

function withTimeout(promise, ms, label) {
    let timer;
    return Promise.race([
        Promise.resolve(promise),
        new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(`${label} timed out after ${Math.ceil(ms / 1000)} seconds`)), ms);
            timer.unref?.();
        })
    ]).finally(() => clearTimeout(timer));
}

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
    // Accept either a raw proto IMessage or a complete WAMessage. Newer
    // Baileys builds may mark the outer key as isViewOnce without retaining
    // the nested media.viewOnce boolean.
    let current = quoted?.message || quoted;
    let isViewOnce = Boolean(quoted?.key?.isViewOnce || quoted?.isViewOnce);

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

            // Resolve the original message by stanza ID. The cache can contain
            // an earlier full payload and the quote can contain a later stub, so
            // try both instead of blindly preferring whichever exists.
            const originalMessageId = ctx.stanzaId;
            const cachedOriginal = originalMessageId && global.viewOnceCache instanceof Map
                ? global.viewOnceCache.get(String(originalMessageId))
                : null;
            const cachedExtracted = extractMedia(cachedOriginal);
            const quotedExtracted = extractMedia({
                key: { isViewOnce: Boolean(ctx.isViewOnce || ctx.key?.isViewOnce) },
                message: ctx.quotedMessage
            });
            const extractionScore = (item) => {
                if (!item) return 0;
                if (hasDownloadLocator(item.media) && item.media.mediaKey) return 3;
                if (item.media.mediaKey) return 2;
                if (hasDownloadLocator(item.media)) return 1;
                return 0;
            };
            const extracted = extractionScore(quotedExtracted) > extractionScore(cachedExtracted)
                ? quotedExtracted
                : (cachedExtracted || quotedExtracted);

            if (!extracted) {
                const isViewOnceStub = Boolean(
                    ctx.isViewOnce ||
                    ctx.key?.isViewOnce ||
                    ctx.quotedMessage?.messageStubType ||
                    ctx.quotedMessage?.imageMessage?.viewOnce ||
                    ctx.quotedMessage?.videoMessage?.viewOnce ||
                    ctx.quotedMessage?.audioMessage?.viewOnce ||
                    ctx.quotedMessage?.viewOnceMessage ||
                    ctx.quotedMessage?.viewOnceMessageV2 ||
                    ctx.quotedMessage?.viewOnceMessageV2Extension
                );
                return await sock.sendMessage(chatId, {
                    text: isViewOnceStub
                        ? '❌ WhatsApp supplied only a View Once placeholder, not the original media payload. The bot cannot download it because this quote and its cache entry contain no media data. Test with a new View Once message while the bot is connected.'
                        : '❌ That message is not a supported View Once image, video, or audio.'
                }, { quoted: msg });
            }

            let { message, type, media } = extracted;

            await sock.sendMessage(chatId, {
                text: '⏳ Processing View Once media...'
            }, { quoted: msg });

            // Use the exact original key whenever available. This preserves
            // remoteJid/fromMe/participant for WhatsApp's media retry protocol.
            const quotedKey = cachedOriginal?.key || {
                remoteJid: ctx.remoteJid || chatId,
                fromMe: Boolean(ctx.participant && ctx.participant === selfJid),
                id: ctx.stanzaId,
                ...(ctx.participant ? { participant: ctx.participant } : {})
            };

            // Important: downloadMediaMessage's reuploadRequest callback is
            // intended for expired media URLs (HTTP 404/410). It cannot repair
            // an object that has no url/directPath at all. Ask WhatsApp for a
            // media re-upload first when we have a mediaKey, then use the
            // refreshed media record returned/mutated by Baileys.
            if (!hasDownloadLocator(media) && media.mediaKey && typeof sock.updateMediaMessage === 'function') {
                // Use the media-bearing content chosen above, but preserve
                // the original full key when the cache has it. A cached stub
                // must not be paired with a richer quoted media payload.
                const originalForRefresh = {
                    key: cachedOriginal?.key || quotedKey,
                    message
                };

                try {
                    const refreshed = await withTimeout(
                        sock.updateMediaMessage(originalForRefresh),
                        15000,
                        'WhatsApp media re-upload request'
                    );
                    const refreshedMessage = refreshed?.message ? refreshed : originalForRefresh;
                    const refreshedExtracted = extractMedia(refreshedMessage);
                    if (refreshedExtracted && hasDownloadLocator(refreshedExtracted.media)) {
                        message = refreshedExtracted.message;
                        media = refreshedExtracted.media;
                        type = refreshedExtracted.type;
                        console.log(`[VV-REUPLOAD] Recovered media locator for ${originalMessageId || 'quoted message'}`);
                    } else {
                        // Some Baileys forks mutate the original WAMessage in
                        // place but return undefined; inspect it once more.
                        const mutatedExtracted = extractMedia(originalForRefresh);
                        if (mutatedExtracted && hasDownloadLocator(mutatedExtracted.media)) {
                            message = mutatedExtracted.message;
                            media = mutatedExtracted.media;
                            type = mutatedExtracted.type;
                            console.log(`[VV-REUPLOAD] Recovered media locator from updated message ${originalMessageId || ''}`);
                        }
                    }
                } catch (refreshError) {
                    console.warn('[VV-REUPLOAD] WhatsApp re-upload attempt failed:', refreshError?.message || refreshError);
                }
            }

            if (!hasDownloadLocator(media)) {
                const reason = media.mediaKey
                    ? 'WhatsApp did not return a media URL/directPath after the re-upload request.'
                    : 'WhatsApp supplied a view-once stub without a mediaKey, URL, or directPath.';
                const error = new Error(reason);
                error.code = 'VV_MEDIA_STUB';
                throw error;
            }

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
            const extension = type === 'imageMessage' ? 'jpg' : 'mp4';
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

            if (error.code === 'VV_MEDIA_STUB') {
                errorMessage = '❌ WhatsApp did not provide downloadable View Once media.';
            } else if (/decrypt|media key/i.test(error.message || '')) {
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
