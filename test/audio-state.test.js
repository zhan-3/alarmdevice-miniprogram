const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeCollectIds,
  filterAndSortAudio,
  findAudioById,
  rebuildAudioList,
  toggleAudioCollection
} = require('../utils/audioState');

test('normalizes legacy JSON-string and current array collection storage', () => {
  assert.deepEqual(normalizeCollectIds('["a","b","a"]'), ['a', 'b']);
  assert.deepEqual(normalizeCollectIds(['a', 'b', 'a']), ['a', 'b']);
  assert.deepEqual(normalizeCollectIds('broken'), []);
});

test('sorting and filtering keeps stable ids instead of positional indexes', () => {
  const source = [
    { id: 'old', sortTime: 1, isCollect: true, status: 'normal' },
    { id: 'new', sortTime: 2, isCollect: false, status: 'emergency' }
  ];

  assert.deepEqual(
    filterAndSortAudio(source, 'all', 'desc').map(item => item.id),
    ['new', 'old']
  );
  assert.deepEqual(
    filterAndSortAudio(source, 'collected', 'desc').map(item => item.id),
    ['old']
  );
  assert.equal(findAudioById(source, 'new').id, 'new');
});

test('rebuilds server records while preserving stable local playback state', () => {
  const existing = {
    id: 'audio_1_old.amr',
    url: 'https://example.com/old.amr',
    duration: '00:12',
    isCollect: false,
    isPlaying: false
  };

  const result = rebuildAudioList({
    urls: ['https://example.com/old.amr', 'https://example.com/new.amr'],
    currentItems: [existing],
    collectIds: ['audio_1_old.amr'],
    currentPlayId: 'audio_1_old.amr',
    isPlaying: true,
    nextId: 1,
    now: new Date('2026-09-06T08:30:00Z')
  });

  assert.equal(result.nextId, 2);
  assert.equal(result.items[0].duration, '00:12');
  assert.equal(result.items[0].isCollect, true);
  assert.equal(result.items[0].isPlaying, true);
  assert.equal(result.items[1].id, 'audio_2_new.amr');
  assert.equal(result.items[1].url, 'https://example.com/new.amr');
});

test('toggles collection state and persisted ids together', () => {
  const source = [
    { id: 'a', isCollect: false },
    { id: 'b', isCollect: true }
  ];

  const collected = toggleAudioCollection(source, ['b'], 'a');
  assert.equal(collected.isCollected, true);
  assert.deepEqual(collected.collectIds, ['b', 'a']);
  assert.equal(collected.items[0].isCollect, true);

  const uncollected = toggleAudioCollection(collected.items, collected.collectIds, 'b');
  assert.equal(uncollected.isCollected, false);
  assert.deepEqual(uncollected.collectIds, ['a']);
  assert.equal(toggleAudioCollection(source, [], 'missing'), null);
});
