
const fs = require('fs');
const {
    downloadContentFromMessage
} = require('@whiskeysockets/baileys');

const {
    createTempFilePath,
    deleteTempFile
} = require('../../utils/tempManager');

function unwrapViewOnce(message) {
    let current = message;

    while (current) {
        if (current.ephemeralMessage?.message) {
            current = current.ephemeralMessage.message;
            continue;
        }

        if (current.viewOnceMessageV2Extension?.message) {
            current = current.viewOnceMessageV2Extension.message;
            continue;
        }

        if (current.viewOnceMessageV2?.message) {
            current = current.viewOnceMessageV2.message;
            continue;
        }

        if (current.viewOnceMessage?.message) {
            current = current.viewOnceMessage.message;
            continue;
        }

        if (current.documentWithCaptionMessage?.message) {
            current = current.documentWithCaptionMessage.message;
            continue;
        }

        break;
    }

    for (const type of ['imageMessage', 'videoMessage', 'audioMessage']) {
        if (current?.[type]) {
            return {
                media: current[type],
                type
            };
        }
    }

    return null;
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

    description: 'Reveal view-once images, videos and audio',

    usage: '.vv (reply to view-once) | .vv2 (reveal in current chat)',

    async execute(sock, msg, args, extra) {
        const chatId = extra.from;

        const selfJid =
            sock.user.id.split(':')[0] + '@s.whatsapp.net';

        const sendToCurrentChat = extra.command === 'vv2';

        const targetJid = sendToCurrentChat
            ? chatId
            : selfJid;

        let tmpPath = null;

        try {
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
                    {
                        text: sendToCurrentChat
                            ? '👁️ Reply to a view-once image or video with *.vv2*.'
                            : '👁️ Reply to a view-once image or video with *.vv*. I will send it to your DM.'
                    },
                    { quoted: msg }
                );
            }

            // First check the quoted message.
            let result = unwrapViewOnce(ctx.quotedMessage);

            // Fallback to cached original message, if available.
            if (!result && ctx.stanzaId) {
                const cached =
                    global.getCachedViewOnceMessage?.(ctx.stanzaId);

                if (cached) {
                    result = unwrapViewOnce(
                        cached.message || cached
                    );
                }
            }

            if (!result) {
                return await sock.sendMessage(
                    chatId,
                    {
                        text: '❌ Could not find supported view-once media in that message.'
                    },
                    { quoted: msg }
                );
            }

            const { media, type } = result;

            const downloadType =
                type === 'imageMessage' ? 'image' :
                type === 'videoMessage' ? 'video' :
                'audio';

            const extension =
                type === 'imageMessage' ? 'jpg' :
                type === 'videoMessage' ? 'mp4' :
                'mp4';

            if (
                !media.mediaKey ||
                (!media.url && !media.directPath)
            ) {
                throw new Error(
                    'Media download information is missing. The original message may not be cached.'
                );
            }

            tmpPath = createTempFilePath('vv', extension);

            const writeStream = fs.createWriteStream(tmpPath);

            const downloadStream =
                await downloadContentFromMessage(media, downloadType);

            await new Promise((resolve, reject) => {
                downloadStream.pipe(writeStream);

                writeStream.on('finish', resolve);
                writeStream.on('error', reject);
                downloadStream.on('error', reject);
            });

            const caption = media.caption || '';

            if (type === 'imageMessage') {
                await sock.sendMessage(targetJid, {
                    image: { url: tmpPath },
                    caption: caption || '🖼️ ViewOnce Image'
                });
            } else if (type === 'videoMessage') {
                await sock.sendMessage(targetJid, {
                    video: { url: tmpPath },
                    caption: caption || '🎬 ViewOnce Video',
                    mimetype: media.mimetype || 'video/mp4'
                });
            } else {
                await sock.sendMessage(targetJid, {
                    audio: { url: tmpPath },
                    mimetype: media.mimetype || 'audio/mp4',
                    ptt: false
                });
            }

            await sock.sendMessage(chatId, {
                react: {
                    text: '✅',
                    key: msg.key
                }
            });

        } catch (error) {
            console.error('[VIEWONCE ERROR]', error);

            await sock.sendMessage(
                chatId,
                {
                    text: `❌ Failed to reveal view-once: ${error.message || 'Unknown error'}`
                },
                { quoted: msg }
            );

        } finally {
            if (tmpPath) {
                deleteTempFile(tmpPath);
            }
        }
    }
};
