 'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  findMediaRecord,
  mediaQuality,
  cacheOriginalMessage,
} = require('../utils/viewOnceCache');

test('findMediaRecord unwraps nested view-once and ephemeral wrappers', () => {
  const original = {
    key: { id: 'vo-1' },
    message: {
      ephemeralMessage: {
        message: {
          viewOnceMessageV2: {
            message: {
              imageMessage: { mediaKey: Buffer.from('key'), directPath: '/media/1' },
            },
          },
        },
      },
    },
  };
  const record = findMediaRecord(original);
  assert.equal(record.type, 'imageMessage');
  assert.equal(record.media.directPath, '/media/1');
  assert.equal(mediaQuality(original), 3);
});

test('a later view-once stub does not overwrite a cached full media message', () => {
  const cache = new Map();
  const full = {
    key: { id: 'vo-2' },
    message: {
      viewOnceMessageV2: {
        message: {
          imageMessage: { mediaKey: Buffer.from('key'), directPath: '/media/2' },
        },
      },
    },
  };
  const stub = {
    key: { id: 'vo-2', isViewOnce: true },
    message: { imageMessage: { viewOnce: true } },
  };

  cacheOriginalMessage(cache, full);
  cacheOriginalMessage(cache, stub);
  assert.equal(cache.get('vo-2'), full);
});

test('a full media update replaces an earlier placeholder', () => {
  const cache = new Map();
  const stub = {
    key: { id: 'vo-3', isViewOnce: true },
    message: { imageMessage: { viewOnce: true } },
  };
  const full = {
    key: { id: 'vo-3' },
    message: { imageMessage: { viewOnce: true, mediaKey: Buffer.from('key') } },
  };

  cacheOriginalMessage(cache, stub);
  cacheOriginalMessage(cache, full);
  assert.equal(cache.get('vo-3'), full);
});

test('cache remains bounded', () => {
  const cache = new Map();
  for (let i = 0; i < 4; i++) {
    cacheOriginalMessage(cache, { key: { id: `id-${i}` }, message: { conversation: 'hi' } }, 3);
  }
  assert.equal(cache.size, 3);
  assert.equal(cache.has('id-0'), false);
});
