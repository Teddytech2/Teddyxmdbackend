const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const { sendButtons } = require('gifted-btns');
const fs   = require('fs');
const path = require('path');
const database = require('../../database');

// Any-emoji pattern — matches a reply that contains only emoji characters (no plain text/digits)
const HAPPY_EMOJI_RE = /^\s*[\p{Extended_Pictographic}\u200d\ufe0f\u20e3\s]+\s*$/u;

// All patterns that trigger auto-save when replying to a status
const SAVE_TRIGGERS = [
    /^\s*(save|send)\s*$/i,
    /^\s*(hello|hey|hi)\s*$/i,
    HAPPY_EMOJI_RE,
];

function isSaveTrigger(text) {
    if (!text || !text.trim()) return false;
    return SAVE_TRIGGERS.some(re => re.test(text.trim()));
}

function isHappyEmoji(text) {
    if (!text || !text.trim()) return false;
    return HAPPY_EMOJI_RE.test(text.trim());
}

// Get bot's own normalised JID from sock.user.id (strips :xx device suffix)
function getBotSelfJid(sock) {
    const raw = sock?.user?.id;
    if (!raw) return null;
    const user = raw.split(':')[0].split('@')[0];
    return `${user}@s.whatsapp.net`;
}

async function downloadStatus(statusMsg) {
    const content = statusMsg;

    const mediaMap = {
        imageMessage:    'image',
        videoMessage:    'video',
        audioMessage:    'audio',
        stickerMessage:  'sticker',
        documentMessage: 'document',
    };

    for (const [key, type] of Object.entries(mediaMap)) {
        if (!content[key]) continue;
        try {
            const stream = await downloadContentFromMessage(content[key], type);
            const chunks = [];
            for await (const chunk of stream) chunks.push(chunk);
            return {
                buffer:  Buffer.concat(chunks),
                type,
                mime:    content[key].mimetype || '',
                caption: content[key].caption  || '',
                ext: { image: '.jpg', video: '.mp4', audio: '.mp3', sticker: '.webp', document: '.bin' }[type] || '.bin',
            };
        } catch (_) {}
    }

    // Text-only status
    const text =
        content.conversation ||
        content.extendedTextMessage?.text ||
        content.ephemeralMessage?.message?.conversation || '';

    if (text) return { type: 'text', text };

    return null;
}

async function sendSavedStatus(sock, chatId, media, quotedMsg) {
    const footer = `> Powered by ${database.getBotSetting('botName')}`;

    if (!media) {
        return sock.sendMessage(chatId, { text: '❌ Could not download status. It may have expired.' }, { quoted: quotedMsg }).catch(() => {});
    }

    if (media.type === 'text') {
        await sendButtons(sock, chatId, {
            text: `💾 *Status Saved!*\n\n📝 *Text:*\n${media.text}`,
            footer,
            buttons: [{
                name: 'cta_copy',
                buttonParamsJson: JSON.stringify({ display_text: '📋 Copy Text', copy_code: media.text })
            }]
        }, { quoted: quotedMsg }).catch(() => {});
        return;
    }

    const caption = media.caption
        ? `💾 *Status Saved!*\n\n💬 ${media.caption}`
        : `💾 *Status Saved!*`;

    if (media.type === 'image') {
        await sock.sendMessage(chatId, { image: media.buffer, caption }, { quoted: quotedMsg });
    } else if (media.type === 'video') {
        await sock.sendMessage(chatId, { video: media.buffer, caption, gifPlayback: false }, { quoted: quotedMsg });
    } else if (media.type === 'audio') {
        await sock.sendMessage(chatId, { audio: media.buffer, mimetype: media.mime || 'audio/mp4', ptt: false }, { quoted: quotedMsg });
    } else if (media.type === 'sticker') {
        await sock.sendMessage(chatId, { sticker: media.buffer }, { quoted: quotedMsg });
    } else {
        await sock.sendMessage(chatId, {
            document: media.buffer,
            mimetype: media.mime || 'application/octet-stream',
            fileName: `status${media.ext}`,
            caption
        }, { quoted: quotedMsg });
    }
}

// Sends the "who/what" header + the saved status content, both to selfJid only
async function forwardToSelf(sock, selfJid, media, senderJid, msg, triggerLabel) {
    if (!selfJid) return;

    try {
        const senderNum  = senderJid.split('@')[0];
        const pushname   = msg?.pushName || `+${senderNum}`;
        const mediaLabel = media
            ? (media.type === 'text' ? '📝 Text status' : `📎 ${media.type.charAt(0).toUpperCase() + media.type.slice(1)} status`)
            : '❓ Unknown';

        await sock.sendMessage(selfJid, {
            text:
                `👁️ *Status Reaction Received*\n\n` +
                `👤 *From:* ${pushname} (+${senderNum})\n` +
                `${triggerLabel}\n` +
                `📦 *Content:* ${mediaLabel}\n\n` +
                `_Forwarding status to your chat..._`
        });

        await sendSavedStatus(sock, selfJid, media, null);
    } catch (_) {}
}

// ── Exported auto-handler — forward every reply to the bot's status to owner ──
async function handleStatusReply(sock, msg) {
    try {
        const from = msg?.key?.remoteJid || '';
        // Status replies arrive as private messages from the person replying.
        if (!from.endsWith('@s.whatsapp.net') && !from.endsWith('@lid')) return false;
        if (msg?.key?.fromMe) return false;

        // WhatsApp may put contextInfo on text, image, video, audio, sticker,
        // document, or a wrapped message. Find the first status reply context.
        const unwrap = (value) => {
            let current = value || {};
            for (let i = 0; i < 5; i++) {
                const next = current.ephemeralMessage?.message ||
                    current.viewOnceMessage?.message ||
                    current.viewOnceMessageV2?.message ||
                    current.documentWithCaptionMessage?.message;
                if (!next) break;
                current = next;
            }
            return current;
        };
        const content = unwrap(msg.message);
        let ctx = null;
        for (const value of Object.values(content || {})) {
            if (value?.contextInfo?.remoteJid === 'status@broadcast') {
                ctx = value.contextInfo;
                break;
            }
        }
        if (!ctx || ctx.remoteJid !== 'status@broadcast') return false;

        // Ignore empty protocol/receipt events; forward the actual reply content.
        const replyMedia = await downloadStatus(content);
        if (!replyMedia) return false;

        const configuredOwners = (typeof database.getOwners === 'function' ? database.getOwners() : [])
            .map(number => `${String(number).replace(/\D/g, '')}@s.whatsapp.net`)
            .filter(jid => jid !== '@s.whatsapp.net');
        const recipients = [...new Set(configuredOwners)];
        // On installations where the paired account itself is the owner and
        // no owner number has been configured yet, use its own chat as fallback.
        if (!recipients.length) {
            const selfJid = getBotSelfJid(sock);
            if (selfJid) recipients.push(selfJid);
        }
        if (!recipients.length) return false;

        const senderNum = from.split('@')[0].split(':')[0];
        const senderName = msg?.pushName || `+${senderNum}`;
        const replyText = content.conversation || content.extendedTextMessage?.text || '';
        const replyLabel = replyMedia.type === 'text' ? 'Text reply' : `${replyMedia.type} reply`;

        for (const ownerJid of recipients) {
            // Do not send the notification back to the person who replied.
            if (ownerJid === from) continue;
            await sock.sendMessage(ownerJid, {
                text: `💬 *Reply to Your WhatsApp Status*\n\n` +
                    `👤 *From:* ${senderName} (+${senderNum})\n` +
                    `📦 *Type:* ${replyLabel}` +
                    (replyText ? `\n📝 *Reply:* ${replyText}` : '')
            }).catch(() => {});
            // Deliver the actual reply (including media) to the owner's inbox.
            await sendSavedStatus(sock, ownerJid, replyMedia, null).catch(() => {});
        }
        return true;
    } catch (_) {
        return false;
    }
}


// Forward replies SENT BY THE CONNECTED BOT ACCOUNT to anyone's status to the owner.
// These are outgoing private messages whose context points back to status@broadcast.
async function handleOutgoingStatusReply(sock, msg) {
    try {
        if (!msg?.key?.fromMe) return false;
        const from = msg?.key?.remoteJid || '';
        if (!from.endsWith('@s.whatsapp.net') && !from.endsWith('@lid')) return false;

        const unwrap = (value) => {
            let current = value || {};
            for (let i = 0; i < 5; i++) {
                const next = current.ephemeralMessage?.message ||
                    current.viewOnceMessage?.message ||
                    current.viewOnceMessageV2?.message ||
                    current.documentWithCaptionMessage?.message;
                if (!next) break;
                current = next;
            }
            return current;
        };
        const content = unwrap(msg.message);
        let ctx = null;
        for (const value of Object.values(content || {})) {
            const candidate = value?.contextInfo;
            if (candidate?.remoteJid === 'status@broadcast' ||
                candidate?.quotedMessage?.key?.remoteJid === 'status@broadcast') {
                ctx = candidate;
                break;
            }
        }
        if (!ctx) return false;

        const replyMedia = await downloadStatus(content);
        if (!replyMedia) return false;

        const configuredOwners = (typeof database.getOwners === 'function' ? database.getOwners() : [])
            .map(number => `${String(number).replace(/\D/g, '')}@s.whatsapp.net`)
            .filter(jid => jid !== '@s.whatsapp.net');
        const recipients = [...new Set(configuredOwners)];
        if (!recipients.length) {
            const selfJid = getBotSelfJid(sock);
            if (selfJid) recipients.push(selfJid);
        }
        if (!recipients.length) return false;

        const targetNum = from.split('@')[0].split(':')[0];
        const replyText = content.conversation || content.extendedTextMessage?.text ||
            content.imageMessage?.caption || content.videoMessage?.caption || '';
        const replyLabel = replyMedia.type === 'text' ? 'Text reply' : `${replyMedia.type} reply`;

        for (const ownerJid of recipients) {
            await sock.sendMessage(ownerJid, {
                text: `📤 *Connected Bot Replied to a WhatsApp Status*\n\n` +
                    `👤 *Status owner:* +${targetNum}\n` +
                    `📦 *Type:* ${replyLabel}` +
                    (replyText ? `\n📝 *Reply:* ${replyText}` : '')
            }).catch(() => {});
            await sendSavedStatus(sock, ownerJid, replyMedia, null).catch(() => {});
        }
        return true;
    } catch (_) {
        return false;
    }
}

// ── Manual command: reply to any status/media in chat with +save ───────────────
module.exports = {
    name: 'savestatus',
    aliases: ['save', 'savest', 'dlstatus'],
    category: 'owner',
    description: 'Save a WhatsApp status by replying to it — saved copy goes to your own chat only',
    usage: '.savestatus — reply to a forwarded status message',
    ownerOnly: false,

    isSaveTrigger,
    handleStatusReply,
    handleOutgoingStatusReply,

    async execute(sock, msg, args, extra) {
        try {
            const chatId = extra.from;

            // ctx covers both manual text replies and sticker replies
            const ctx =
                msg.message?.extendedTextMessage?.contextInfo ||
                msg.message?.stickerMessage?.contextInfo;
            const quotedMsg = ctx?.quotedMessage;

            if (!quotedMsg) {
                if (extra.forwardToSelf) return;
                return extra.reply(
                    `💾 *Save Status*\n\n` +
                    `Reply to a status message with:\n` +
                    `  *${database.getBotSetting('prefix')}save* — manual save\n` +
                    `  _Or just reply with:_ save · send · hello · hey · 😊\n\n` +
                    `_Saved copy is sent to your own chat only._`
                );
            }

            await sock.sendMessage(chatId, { react: { text: '💾', key: msg.key } }).catch(() => {});

            const media = await downloadStatus(quotedMsg);

            // ── Only ever deliver to bot's self chat ──
            const selfJid = getBotSelfJid(sock);
            const triggerLabel = extra.triggerLabel || `💾 *Trigger:* Manual save`;
            await forwardToSelf(sock, selfJid, media, chatId, msg, triggerLabel);

        } catch (error) {
            await extra.reply(`❌ Failed to save status:\n${error.message}`);
        }
    }
};
