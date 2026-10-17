function normalizeCollectIds(value) {
  let ids = value;
  if (typeof ids === 'string') {
    try {
      ids = JSON.parse(ids);
    } catch (err) {
      ids = [];
    }
  }
  if (!Array.isArray(ids)) return [];
  return [...new Set(ids.filter(id => typeof id === 'string' && id))];
}

function filterAndSortAudio(source, filterType, sortType) {
  const list = (Array.isArray(source) ? source : []).filter(item =>
    filterType === 'all' ||
    (filterType === 'collected' && item.isCollect) ||
    (filterType === 'emergency' && item.status === 'emergency')
  );
  const sign = sortType === 'desc' ? -1 : 1;
  return list.slice().sort((a, b) => (a.sortTime - b.sortTime) * sign);
}

function findAudioById(source, id) {
  return (Array.isArray(source) ? source : []).find(item => item.id === id) || null;
}

function createAudioItem(url, id, now = new Date()) {
  const fileName = String(url).split('/').pop();
  return {
    id,
    name: fileName || `录音_${id.slice(-4)}`,
    time: now.toTimeString().slice(0, 5),
    date: now.toISOString().slice(0, 10),
    sortTime: now.getTime(),
    duration: '00:00',
    size: '0MB',
    location: '未知',
    status: 'normal',
    url,
    isPlaying: false,
    isCollect: false
  };
}

function rebuildAudioList({
  urls,
  currentItems,
  collectIds,
  currentPlayId,
  isPlaying,
  nextId = 0,
  now = new Date()
}) {
  const existingByUrl = new Map(
    (Array.isArray(currentItems) ? currentItems : [])
      .filter(item => item && item.url)
      .map(item => [item.url, item])
  );
  const collected = new Set(normalizeCollectIds(collectIds));
  let idSequence = nextId;

  const items = (Array.isArray(urls) ? urls : []).filter(Boolean).map(url => {
    const existing = existingByUrl.get(url);
    const item = existing
      ? { ...existing }
      : createAudioItem(url, `audio_${++idSequence}_${url.split('/').pop()}`, now);
    return {
      ...item,
      isCollect: collected.has(item.id),
      isPlaying: item.id === currentPlayId && Boolean(isPlaying)
    };
  });

  return { items, nextId: idSequence };
}

function toggleAudioCollection(source, collectIds, id) {
  const current = findAudioById(source, id);
  if (!current) return null;

  const isCollected = !current.isCollect;
  const items = source.map(item => item.id === id ? { ...item, isCollect: isCollected } : item);
  const normalizedIds = normalizeCollectIds(collectIds);
  const nextCollectIds = isCollected
    ? [...new Set([...normalizedIds, id])]
    : normalizedIds.filter(itemId => itemId !== id);

  return { items, collectIds: nextCollectIds, isCollected };
}

module.exports = {
  normalizeCollectIds,
  filterAndSortAudio,
  findAudioById,
  rebuildAudioList,
  toggleAudioCollection
};
