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

module.exports = Object.freeze({
  port: Number(process.env.PORT) || 5000,
  sessionId: process.env.SESSION_ID || '',
  prefix: process.env.PREFIX || '.',
  ownerNumber: String(process.env.OWNER_NUMBER || '').replace(/\D/g, ''),
  botMode: choice(process.env.BOT_MODE || process.env.MODE, ['public', 'private', 'group', 'pm'], 'public'),
  antideleteMode: choice(process.env.ANTIDELETE_MODE, ['off', 'chat', 'private'], 'off'),
  statusMode: choice(process.env.STATUS_MODE, ['off', 'typing', 'recording', 'recordtype'], 'off'),
  antilinkAction: choice(process.env.ANTILINK_ACTION, ['delete', 'kick', 'off'], 'off'),
  autoStatusView: enabled(process.env.AUTOSTATUSVIEW, false),
  autoReactStatus: enabled(process.env.AUTOREACTSTATUS, false),
  autoReactStatusEmoji: statusEmojiPool[0],
  autoReactStatusEmojiPool: statusEmojiPool,
  autoReactStatusRandomEmoji: enabled(process.env.AUTOREACTSTATUS_RANDOM, statusEmojiPool.length > 1),
  timezone: process.env.TIMEZONE || 'Africa/Nairobi',
});
