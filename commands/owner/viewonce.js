/**
 * ViewOnce Command
 *   .vv  — reveals view-once and forwards to owner's DM (private)
 *   .vv2 — reveals view-once and sends in the current chat
 *
 * No file-size limit: content is streamed to a temp file and sent via file
 * path so Baileys can upload in chunks regardless of how large the media is.
 */

const fs = require('fs');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const { createTempFilePath, deleteTempFile } = require('../../utils/tempManager');

const MEDIA_TYPES = Object.freeze({
    imageMessage: 'image',
    videoMessage: 'video',
    audioMessage: 'audio',
});

// WhatsApp may nest view-once payloads inside ephemeral and other wrappers.
// Walk the payload instead of assuming the view-once wrapper is at the root.
function extractViewOnceMedia(message, depth = 0, insideViewOnce = false) {
    if (!message || typeof message !== 'object' || depth > 8) return null;

    for (const [type, downloadType] of Object.entries(MEDIA_TYPES)) {
        const media = message[type];
        if (media && (insideViewOnce || media.viewOnce)) {
            return { type, downloadType, media };
        }
    }

    const wrappers = [
        'ephemeralMessage', 'viewOnceMessageV2Extension',
        'viewOnceMessageV2', 'viewOnceMessage', 'documentWithCaptionMessage',
    ];
    for (const wrapper of wrappers) {
        const inner = message[wrapper]?.message;
        if (!inner) continue;
        const isViewOnceWrapper = wrapper.startsWith('viewOnceMessage');
        const found = extractViewOnceMedia(inner, depth + 1, insideViewOnce || isViewOnceWrapper);
        if (found) return found;
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

    async execute(sock, msg, args, extra) {
        const chatId  = extra.from;
        const selfJid = sock.user.id.split(':')[0] + '@s.whatsapp.net';

        // vv2 sends to current chat; vv sends to owner DM
        const sendToCurrentChat = extra.command === 'vv2';
        const targetJid = sendToCurrentChat ? chatId : selfJid;

        let tmpPath = null;
        try {
            // ── Extract quoted context ─────────────────────────────────────
            const ctx =
                msg.message?.extendedTextMessage?.contextInfo ||
                msg.message?.stickerMessage?.contextInfo ||
                msg.message?.imageMessage?.contextInfo ||
                msg.message?.videoMessage?.contextInfo ||
                msg.message?.buttonsResponseMessage?.contextInfo ||
                msg.message?.listResponseMessage?.contextInfo;

            if (!ctx?.quotedMessage) {
                return await sock.sendMessage(
                    chatId,
                    { text: sendToCurrentChat
                        ? '🗑️ Reply to a *view-once* message with *.vv2* to reveal it here.'
                        : '🗑️ Reply to a *view-once* message with *.vv* to reveal it in your DM.'
                    },
                    { quoted: msg }
                );
            }

            const quoted = ctx.quotedMessage;

            // ── Unwrap and identify the actual view-once media ─────────────
            const extracted = extractViewOnceMedia(quoted);
            if (!extracted) {
                return await sock.sendMessage(
                    chatId,
                    { text: '❌ That is not a supported view-once image, video, or audio message.' },
                    { quoted: msg }
                );
            }

            const { type: mtype, downloadType, media } = extracted;
            if (!media || (!media.url && !media.directPath && !media.mediaKey)) {
                return await sock.sendMessage(
                    chatId,
                    { text: '❌ WhatsApp did not include downloadable media data in this quoted message. Try quoting the original view-once message again.' },
                    { quoted: msg }
                );
            }

            // ── Stream to temp file (no memory limit) ─────────────────────
            const ext =
                mtype === 'imageMessage' ? 'jpg' :
                mtype === 'videoMessage' ? 'mp4' : 'mp4';

            tmpPath = createTempFilePath('vv', ext);
            const writeStream = fs.createWriteStream(tmpPath);
            const dlStream    = await downloadContentFromMessage(actualMsg[mtype], downloadType);
            await new Promise((resolve, reject) => {
                dlStream.pipe(writeStream);
                writeStream.on('finish', resolve);
                writeStream.on('error', reject);
                dlStream.on('error', reject);
            });

            const caption = media.caption || '';

            // ── Send via file path — Baileys streams upload, no size cap ──
            if (mtype === 'imageMessage') {
                await sock.sendMessage(targetJid, {
                    image: { url: tmpPath },
                    caption: caption || '🖼️ *ViewOnce Image*'
                });
            } else if (mtype === 'videoMessage') {
                await sock.sendMessage(targetJid, {
                    video: { url: tmpPath },
                    caption: caption || '🎬 *ViewOnce Video*',
                    mimetype: 'video/mp4'
                });
            } else {
                await sock.sendMessage(targetJid, {
                    audio: { url: tmpPath },
                    mimetype: media.mimetype || 'audio/mp4',
                    ptt: false
                });
            }

            // ── React ✅ in the original chat ──────────────────────────────
            await sock.sendMessage(chatId, {
                react: { text: '✅', key: msg.key }
            });

        } catch (error) {
            await sock.sendMessage(
                chatId,
                { text: `❌ Failed to reveal view-once: ${error.message || 'Unknown error'}` },
                { quoted: msg }
            );
        } finally {
            // Always clean up the temp file
            if (tmpPath) deleteTempFile(tmpPath);
        }
    }
};
