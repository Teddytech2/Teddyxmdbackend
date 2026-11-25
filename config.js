/**
 * TEDDY-XMD-ULTRA deployment defaults.
 * SQLite/database-backed settings changed with bot commands remain authoritative.
 */
function choice(value, allowed, fallback) {
  const normalized = String(value ?? '').trim().toLowerCase();
  return allowed.includes(normalized) ? normalized : fallback;
}
function enabled(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return /^(1|true|yes|on)$/i.test(String(value).trim());
}
function parseEmojiList(value, fallback = ['💙']) {
  const found = [...String(value || '').matchAll(/\p{Extended_Pictographic}(?:\u200D\p{Extended_Pictographic})*/gu)]
    .map(match => match[0]);
  return found.length ? found : fallback;
}

const statusEmojiPool = parseEmojiList(process.env.AUTOREACTSTATUS_EMOJI || process.env.AUTOSTATUS_EMOJI);

const deploymentSettings = {
  botName: process.env.BOT_NAME, autoRead: process.env.AUTOREAD == null ? undefined : enabled(process.env.AUTOREAD),
  autoReact: process.env.AUTOREACT == null ? undefined : enabled(process.env.AUTOREACT),
  antieditMode: process.env.ANTIEDIT_MODE, antideleteStatus: process.env.ANTIDELETE_STATUS == null ? undefined : enabled(process.env.ANTIDELETE_STATUS),
  alwaysOnline: process.env.ALWAYS_ONLINE == null ? undefined : enabled(process.env.ALWAYS_ONLINE),
  fontStyle: process.env.FONT_STYLE, readReceipts: process.env.READ_RECEIPTS, autoReadMode: process.env.AUTOREAD_MODE,
  autoBio: process.env.AUTO_BIO == null ? undefined : enabled(process.env.AUTO_BIO),
  autoSticker: process.env.AUTO_STICKER == null ? undefined : enabled(process.env.AUTO_STICKER),
  autoTyping: process.env.AUTO_TYPING == null ? undefined : enabled(process.env.AUTO_TYPING),
  autoRecording: process.env.AUTO_RECORDING == null ? undefined : enabled(process.env.AUTO_RECORDING),
  autoRecordType: process.env.AUTO_RECORDTYPE == null ? undefined : enabled(process.env.AUTO_RECORDTYPE),
  autoStatusEmoji: process.env.AUTOREACTSTATUS_EMOJI, autoStatusEmojiPool: process.env.AUTOREACTSTATUS_EMOJI ? statusEmojiPool : undefined,
  autoStatusView: process.env.AUTOSTATUSVIEW == null ? undefined : enabled(process.env.AUTOSTATUSVIEW, true),
  autoStatusRandomEmoji: process.env.AUTOREACTSTATUS_RANDOM == null ? undefined : enabled(process.env.AUTOREACTSTATUS_RANDOM),
};

module.exports = Object.freeze({
  deploymentSettings: Object.freeze(deploymentSettings),
  port: Number(process.env.PORT) || 5000,
  sessionId: process.env.SESSION_ID || '',
  prefix: process.env.PREFIX || '.',
  ownerNumber: String(process.env.OWNER_NUMBER || '').replace(/\D/g, ''),
  botMode: choice(process.env.BOT_MODE || process.env.MODE || (enabled(process.env.SELF_MODE) ? 'self' : undefined), ['public', 'private', 'group', 'pm', 'self'], 'public'),
  antideleteMode: choice(process.env.ANTIDELETE_MODE, ['off', 'chat', 'private'], 'private'),
  statusMode: choice(process.env.STATUS_MODE, ['off', 'typing', 'recording', 'recordtype'], 'off'),
  antilinkAction: choice(process.env.ANTILINK_ACTION, ['delete', 'kick', 'off'], 'off'),
  autoStatusView: enabled(process.env.AUTOSTATUSVIEW, true),
  autoReactStatus: enabled(process.env.AUTOREACTSTATUS, false),
  autoReactStatusEmoji: statusEmojiPool[0],
  autoReactStatusEmojiPool: statusEmojiPool,
  autoReactStatusRandomEmoji: enabled(process.env.AUTOREACTSTATUS_RANDOM, statusEmojiPool.length > 1),
  timezone: process.env.TIMEZONE || 'Africa/Nairobi',
  // MongoDB credentials are read from Heroku Config Vars; never hardcode them.
  mongodbUri: String(process.env.MONGODB_URI || process.env.MONGODB_URL || process.env.MONGO_URL || 'mongodb+srv://mercymwangangi30_db_user:ypP8wsnSChA38CUk@cluster0.pvc7zqd.mongodb.net/?appName=Cluster0').trim(),
  mongoDatabase: process.env.TEDDY_MONGO_DB || process.env.MONGO_DB || 'teddyDb',
  mongoBotId: process.env.PN || process.env.TEDDY_PN || process.env.TEDDY_BOT_ID || process.env.BOT_ID || process.env.OWNER_NUMBER || '',
});
