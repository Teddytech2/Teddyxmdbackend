// Shared in-memory cache for original WhatsApp messages used by .vv.
// A message with mediaKey is more useful than a later view-once placeholder;
// never let a stub overwrite a message that still has usable media material.
'use strict';

const MEDIA_KEYS = ['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage', 'stickerMessage'];
const WRAPPER_KEYS = [
  'ephemeralMessage',
  'viewOnceMessage',
  'viewOnceMessageV2',
  'viewOnceMessageV2Extension',
  'documentWithCaptionMessage',
];

function findMediaRecord(value) {
  const root = value?.message || value;
  if (!root || typeof root !== 'object') return null;

  const stack = [root];
  const visited = new Set();
  while (stack.length) {
    const current = stack.pop();
    if (!current || typeof current !== 'object' || visited.has(current)) continue;
    visited.add(current);

    for (const key of MEDIA_KEYS) {
      const media = current[key];
      if (media && typeof media === 'object') return { type: key, media };
    }

    for (const key of WRAPPER_KEYS) {
      const nested = current[key]?.message;
      if (nested && typeof nested === 'object') stack.push(nested);
    }

    // Cover protocol wrappers added by future WhatsApp/Baileys versions.
    for (const [key, nested] of Object.entries(current)) {
      if (nested && typeof nested === 'object' && !WRAPPER_KEYS.includes(key)) {
        // Do not walk into large byte arrays or unrelated protobuf internals.
        if (!Buffer.isBuffer(nested) && !ArrayBuffer.isView(nested) && !Array.isArray(nested)) {
          if (nested.message && typeof nested.message === 'object') stack.push(nested.message);
        }
      }
    }
  }
  return null;
}

function mediaQuality(message) {
  const record = findMediaRecord(message);
  if (!record) return 0;
  const media = record.media;
  const hasKey = Boolean(media.mediaKey);
  const hasLocator = Boolean(media.url || media.directPath);
  if (hasKey && hasLocator) return 3;
  if (hasKey) return 2;
  if (hasLocator) return 1;
  return 0;
}

function cacheOriginalMessage(cache, message, maxEntries = 500) {
  const id = message?.key?.id;
  if (!(cache instanceof Map) || !id || !message?.message) return null;

  const cacheKey = String(id);
  const existing = cache.get(cacheKey);
  if (existing && mediaQuality(existing) > mediaQuality(message)) {
    return existing;
  }

  cache.set(cacheKey, message);
  while (cache.size > maxEntries) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  return message;
}

module.exports = { findMediaRecord, mediaQuality, cacheOriginalMessage };
