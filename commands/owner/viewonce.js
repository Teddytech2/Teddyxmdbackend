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

function getContextInfo(msg) {
    const m = msg.message || {};
    for (const v of Object.values(m)) {
        if (v?.contextInfo?.stanzaId) return v.contextInfo;
    }
    return m.extendedTextMessage?.contextInfo || null;
}

function extractViewOnceFromFullMessage(fullWAMsg) {
    // fullWAMsg can be { message: {...} } or direct
    let cur = fullWAMsg.message || fullWAMsg;
    for (let i = 0; i < 6; i++) {
        if (cur.ephemeralMessage?.message) cur = cur.ephemeralMessage.message;
        else if (cur.viewOnceMessageV2Extension?.message) cur = cur.viewOnceMessageV2Extension.message;
        else if (cur.viewOnceMessageV2?.message) cur = cur.viewOnceMessageV2.message;
        else if (cur.viewOnceMessage?.message) cur = cur.viewOnceMessage.message;
        else break;
    }
    const t = Object.keys(cur)[0];
    if (['imageMessage','videoMessage','audioMessage','ptvMessage'].includes(t)) return cur;
    return null;
}

module.exports = {
    name: 'viewonce',
    aliases: ['vv', 'vv2'],
    ownerOnly: true,

    async execute(sock, msg, args, extra) {
        const chatId = extra.from || msg.key.remoteJid;
        const body = (msg.message?.extendedTextMessage?.text || msg.message?.conversation || '').toLowerCase();
        const isVv2 = body.startsWith('.vv2');
        const selfJid = sock.user.id.split(':')[0].split('@')[0] + '@s.whatsapp.net';
        const targetJid = isVv2 ? chatId : selfJid;

        let tmpPath = null;
        try {
            const ctx = getContextInfo(msg);
            if (!ctx?.stanzaId) {
                return await sock.sendMessage(chatId, { text: '🗑️ Reply to a view-once message with .vv' }, { quoted: msg });
            }

            // TRY 1: Load full original message from Baileys store / TEDDY DB
            let fullMsg = null;
            
            // Baileys in-memory store
            try {
                if (sock.store?.loadMessage) {
                    fullMsg = await sock.store.loadMessage(chatId, ctx.stanzaId);
                }
            } catch {}

            // TEDDY SQLite store - try to find in recent messages cache
            if (!fullMsg && global?.teddyStore?.getMessage) {
                try { fullMsg = await global.teddyStore.getMessage(chatId, ctx.stanzaId); } catch {}
            }

            // If store failed, fallback to quoted preview (will fail if expired, but we try)
            if (!fullMsg) {
                fullMsg = { message: ctx.quotedMessage };
                console.log('VV WARN: store miss, using quoted preview - may have no url');
            }

            const actualMsg = extractViewOnceFromFullMessage(fullMsg);
            if (!actualMsg) {
                console.log('VV DEBUG fullMsg keys:', Object.keys(fullMsg.message || fullMsg));
                return await sock.sendMessage(chatId, { text: '❌ Not a view-once or message not found in store. Send view-once and immediately reply .vv without opening.' }, { quoted: msg });
            }

            const mtype = Object.keys(actualMsg)[0];
            const mediaObj = actualMsg[mtype];
            
            // clear viewOnce flags
            delete mediaObj.viewOnce;
            delete mediaObj.isViewOnce;

            if (!mediaObj.directPath && !mediaObj.url) {
                return await sock.sendMessage(chatId, { text: '❌ WhatsApp removed the media (already opened on another device). Send a NEW unopened view-once and reply instantly.' }, { quoted: msg });
            }

            const dlType = mtype === 'imageMessage' ? 'image' : mtype === 'videoMessage' || mtype === 'ptvMessage' ? 'video' : 'audio';
            const ext = mtype === 'imageMessage' ? 'jpg' : 'mp4';

            tmpPath = createTempFilePath('vv', ext);
            const stream = await downloadContentFromMessage(mediaObj, dlType);
            let buf = Buffer.from([]);
            for await (const chunk of stream) buf = Buffer.concat([buf, chunk]);
            fs.writeFileSync(tmpPath, buf);

            if (mtype === 'imageMessage') {
                await sock.sendMessage(targetJid, { image: { url: tmpPath }, caption: mediaObj.caption || '🖼️ ViewOnce' });
            } else {
                await sock.sendMessage(targetJid, { video: { url: tmpPath }, caption: mediaObj.caption || '🎬 ViewOnce', mimetype: 'video/mp4' });
            }

            await sock.sendMessage(chatId, { react: { text: '✅', key: msg.key } });

        } catch (e) {
            console.error('VV ERROR', e);
            await sock.sendMessage(chatId, { text: `❌ Failed: ${e.message}` }, { quoted: msg });
        } finally {
            if (tmpPath) setTimeout(() => deleteTempFile(tmpPath), 8000);
        }
    }
};
