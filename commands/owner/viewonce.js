const fs = require('fs');
const { downloadContentFromMessage, downloadMediaMessage } = require('@whiskeysockets/baileys');

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

function extractFromFull(full) {
    let cur = full.message || full;
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
            if (!ctx?.stanzaId) return await sock.sendMessage(chatId, { text: 'Reply to a view-once' }, { quoted: msg });

            global.viewOnceCache = global.viewOnceCache || new Map();
            
            // 1. Try cache first (THIS IS THE KEY)
            let fullMsg = global.viewOnceCache.get(ctx.stanzaId);
            
            // 2. Try Baileys store
            if (!fullMsg && sock.store?.loadMessage) {
                try { fullMsg = await sock.store.loadMessage(chatId, ctx.stanzaId); } catch {}
            }
            
            // 3. Fallback to quoted preview
            if (!fullMsg) fullMsg = { message: ctx.quotedMessage };

            const actualMsg = extractFromFull(fullMsg);
            if (!actualMsg) return await sock.sendMessage(chatId, { text: '❌ Message not in cache. Send a NEW view-once AFTER restarting bot, then instantly .vv' }, { quoted: msg });

            const mtype = Object.keys(actualMsg)[0];
            const mediaObj = actualMsg[mtype];
            delete mediaObj.viewOnce;

            // Try reupload if no directPath
            let buffer;
            try {
                if (mediaObj.directPath || mediaObj.url) {
                    const stream = await downloadContentFromMessage(mediaObj, mtype === 'imageMessage' ? 'image' : 'video');
                    buffer = Buffer.from([]);
                    for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
                } else {
                    // Ask sender to reupload
                    buffer = await downloadMediaMessage(fullMsg, 'buffer', {}, { 
                        logger: console, 
                        reuploadRequest: sock.updateMediaMessage 
                    });
                }
            } catch (e) {
                console.log('Download failed, trying reupload:', e.message);
                buffer = await downloadMediaMessage(fullMsg, 'buffer', {}, { 
                    logger: console, 
                    reuploadRequest: sock.updateMediaMessage 
                });
            }

            tmpPath = createTempFilePath('vv', mtype === 'imageMessage' ? 'jpg' : 'mp4');
            fs.writeFileSync(tmpPath, buffer);

            if (mtype === 'imageMessage') {
                await sock.sendMessage(targetJid, { image: { url: tmpPath }, caption: mediaObj.caption || '' });
            } else {
                await sock.sendMessage(targetJid, { video: { url: tmpPath }, caption: mediaObj.caption || '', mimetype: 'video/mp4' });
            }
            await sock.sendMessage(chatId, { react: { text: '✅', key: msg.key } });

        } catch (e) {
            console.error('VV FINAL ERROR', e);
            await sock.sendMessage(chatId, { text: `❌ Failed: ${e.message}\nMake sure you sent the view-once AFTER bot started and didn't open it.` }, { quoted: msg });
        } finally {
            if (tmpPath) setTimeout(() => deleteTempFile(tmpPath), 8000);
        }
    }
};
