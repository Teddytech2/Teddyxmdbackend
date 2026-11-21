const fs = require('fs');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');

let createTempFilePath, deleteTempFile;
try {
    ({ createTempFilePath, deleteTempFile } = require('../../utils/tempManager'));
} catch {
    const os = require('os'), path = require('path');
    createTempFilePath = (p, ext) => path.join(os.tmpdir(), `${p}-${Date.now()}.${ext}`);
    deleteTempFile = (p) => { try { fs.unlinkSync(p); } catch {} };
}

function getQuotedMessage(msg) {
    const m = msg.message || {};
    return m.extendedTextMessage?.contextInfo?.quotedMessage
        || m.imageMessage?.contextInfo?.quotedMessage
        || m.videoMessage?.contextInfo?.quotedMessage
        || m.stickerMessage?.contextInfo?.quotedMessage
        || Object.values(m).find(v => v?.contextInfo?.quotedMessage)?.contextInfo?.quotedMessage
        || null;
}

function extractViewOnce(quoted) {
    if (!quoted) return null;
    let current = quoted;
    for (let i = 0; i < 6; i++) {
        if (current.ephemeralMessage?.message) current = current.ephemeralMessage.message;
        else if (current.viewOnceMessageV2Extension?.message) current = current.viewOnceMessageV2Extension.message;
        else if (current.viewOnceMessageV2?.message) current = current.viewOnceMessageV2.message;
        else if (current.viewOnceMessage?.message) current = current.viewOnceMessage.message;
        else break;
    }
    const type = Object.keys(current)[0];
    if (['imageMessage','videoMessage','audioMessage','ptvMessage'].includes(type)) return current;
    return null;
}

module.exports = {
    name: 'viewonce',
    aliases: ['vv', 'vv2'],
    ownerOnly: true,

    async execute(sock, msg, args, extra) {
        const chatId = extra.from || msg.key.remoteJid;
        const body = (msg.message?.extendedTextMessage?.text || msg.message?.conversation || '').toLowerCase();
        const isVv2 = body.startsWith('.vv2') || body.startsWith('!vv2');
        const selfJid = sock.user.id.split(':')[0].split('@')[0] + '@s.whatsapp.net';
        const targetJid = isVv2 ? chatId : selfJid;

        let tmpPath = null;
        try {
            const quotedRaw = getQuotedMessage(msg);
            if (!quotedRaw) return await sock.sendMessage(chatId, { text: '🗑️ Reply to a view-once with .vv' }, { quoted: msg });

            const actualMsg = extractViewOnce(quotedRaw);
            if (!actualMsg) return await sock.sendMessage(chatId, { text: '❌ Not a view-once message' }, { quoted: msg });

            const mtype = Object.keys(actualMsg)[0];
            const mediaObj = actualMsg[mtype];

            // --- THIS IS THE FIX FOR YOUR ERROR ---
            // Baileys won't give directPath if viewOnce is still true
            if (mediaObj.viewOnce) delete mediaObj.viewOnce;
            if (mediaObj.viewOnceV2) delete mediaObj.viewOnceV2;
            if (mediaObj.viewOnceV2Extension) delete mediaObj.viewOnceV2Extension;
            // ---------------------------------------

            const downloadType = mtype === 'imageMessage' ? 'image' : mtype === 'videoMessage' || mtype === 'ptvMessage' ? 'video' : 'audio';
            const ext = mtype === 'imageMessage' ? 'jpg' : mtype === 'videoMessage' || mtype === 'ptvMessage' ? 'mp4' : 'mp3';

            tmpPath = createTempFilePath('vv', ext);

            // Download to buffer first - more reliable
            const stream = await downloadContentFromMessage(mediaObj, downloadType);
            let buffer = Buffer.from([]);
            for await (const chunk of stream) {
                buffer = Buffer.concat([buffer, chunk]);
            }
            fs.writeFileSync(tmpPath, buffer);

            if (mtype === 'imageMessage') {
                await sock.sendMessage(targetJid, { image: { url: tmpPath }, caption: mediaObj.caption || '🖼️ ViewOnce' });
            } else if (mtype === 'videoMessage' || mtype === 'ptvMessage') {
                await sock.sendMessage(targetJid, { video: { url: tmpPath }, caption: mediaObj.caption || '🎬 ViewOnce', mimetype: 'video/mp4' });
            } else {
                await sock.sendMessage(targetJid, { audio: { url: tmpPath }, mimetype: mediaObj.mimetype || 'audio/mp4', ptt: false });
            }

            await sock.sendMessage(chatId, { react: { text: '✅', key: msg.key } });

        } catch (e) {
            console.error('VV ERROR:', e);
            await sock.sendMessage(chatId, { text: `❌ Failed: ${e.message}` }, { quoted: msg });
        } finally {
            if (tmpPath) setTimeout(() => deleteTempFile(tmpPath), 5000);
        }
    }
};
