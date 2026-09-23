const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadAudioPage(wx) {
  const pagePath = path.join(__dirname, '../pages/audio/audio.js');
  const source = fs.readFileSync(pagePath, 'utf8')
    .replace("import { setStorage, getStorage } from '../../utils/storage'", 'const { setStorage, getStorage } = globalThis.__deps')
    .replace("import http from '../../utils/http'", 'const http = globalThis.__deps.http')
    .replace("import logger from '../../utils/logger'", 'const logger = globalThis.__deps.logger');

  let definition;
  vm.runInNewContext(source, {
    __deps: {
      setStorage() {},
      getStorage(_key, fallback) { return fallback; },
      http: {},
      logger: { error() {}, warn() {} }
    },
    Page(value) { definition = value; },
    wx,
    getApp() { return {}; },
    require(request) {
      if (request.endsWith('/audioState')) return require('../utils/audioState');
      throw new Error(`Unexpected require: ${request}`);
    },
    console,
    Promise,
    String,
    Boolean,
    Number,
    Date,
    Set,
    Array,
    Math,
    parseFloat,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval
  }, { filename: pagePath });
  return definition;
}

function createPage(definition, data = {}) {
  return {
    ...definition,
    data: { ...definition.data, ...data },
    setData(update) { Object.assign(this.data, update); },
    startProgressTimer() {},
    clearProgressTimer() {}
  };
}

function createInnerAudio(calls, handlers = {}) {
  let source = '';
  return {
    duration: 12,
    currentTime: 0,
    set src(value) {
      source = value;
      calls.push(['load', value]);
    },
    get src() { return source; },
    set playbackRate(value) { calls.push(['rate', value]); },
    play() { calls.push(['play']); },
    pause() { calls.push(['pause']); },
    stop() { calls.push(['stop']); },
    seek() {},
    destroy() {},
    onCanplay(callback) { handlers.canplay = callback; },
    offCanplay() {},
    onError(callback) { handlers.error = callback; },
    offError() {},
    onPlay(callback) { handlers.play = callback; },
    offPlay() {},
    onPause() {},
    offPause() {},
    onStop() {},
    offStop() {},
    onTimeUpdate() {},
    offTimeUpdate() {},
    onEnded() {},
    offEnded() {}
  };
}

test('first play reuses the selected source instead of stopping and loading it again', () => {
  const calls = [];
  const innerAudio = createInnerAudio(calls);
  const wx = {
    createInnerAudioContext: () => innerAudio,
    showLoading() {},
    hideLoading() {},
    toast() {}
  };
  const definition = loadAudioPage(wx);
  const url = 'https://bridgemonitor.xyz/audio/test_SN001_20260920093030.mp3';
  const page = createPage(definition, {
    currentAudio: { id: 'sn001-record-1', url },
    currentPlayId: 'sn001-record-1',
    isPlaying: false,
    playbackRate: 1
  });

  page.initAudioManager();
  page.data.audioManager.load(url);
  calls.length = 0;

  page.togglePlay();

  assert.deepEqual(calls, [['rate', 1], ['play']]);
});

test('first play starts immediately even before duration metadata is available', () => {
  const calls = [];
  const innerAudio = createInnerAudio(calls);
  innerAudio.duration = 0;
  const wx = {
    createInnerAudioContext: () => innerAudio,
    showLoading() {},
    hideLoading() {},
    toast() {}
  };
  const definition = loadAudioPage(wx);
  const url = 'https://bridgemonitor.xyz/audio/test_SN001_20260920093030.mp3';
  const page = createPage(definition, {
    currentAudio: { id: 'sn001-record-1', url },
    currentPlayId: 'sn001-record-1',
    isPlaying: false,
    playbackRate: 1
  });

  page.initAudioManager();
  page.data.audioManager.load(url);
  calls.length = 0;

  page.togglePlay();

  assert.equal(calls.some(([operation]) => operation === 'play'), true);
});

test('selecting an audio while idle does not pause an inactive context', () => {
  const calls = [];
  const innerAudio = createInnerAudio(calls);
  const wx = {
    createInnerAudioContext: () => innerAudio,
    showLoading() {},
    hideLoading() {},
    toast() {}
  };
  const definition = loadAudioPage(wx);
  const audio = {
    id: 'sn001-record-1',
    url: 'https://bridgemonitor.xyz/audio/test_SN001_20260920093030.mp3'
  };
  const page = createPage(definition, {
    audioList: [audio],
    filteredList: [audio],
    isPlaying: false
  });
  page.updateFilteredList = () => {};
  page.initAudioManager();

  page.selectAudio({ currentTarget: { dataset: { id: audio.id } } });

  assert.equal(calls.some(([operation]) => operation === 'pause'), false);
});

test('an idle pause operation failure is ignored instead of resetting the source', () => {
  const calls = [];
  const handlers = {};
  const toasts = [];
  const innerAudio = createInnerAudio(calls, handlers);
  const wx = {
    createInnerAudioContext: () => innerAudio,
    showLoading() {},
    hideLoading() {},
    toast(options) { toasts.push(options); }
  };
  const definition = loadAudioPage(wx);
  const page = createPage(definition, {
    isPlaying: false,
    currentPlayId: 'sn001-record-1',
    audioList: [{ id: 'sn001-record-1', isPlaying: false }]
  });
  page.initAudioManager();
  page.setupAudioListeners();
  calls.length = 0;

  handlers.error({ errMsg: 'operateAudio:fail:pause audio fail' });

  assert.deepEqual(toasts, []);
  assert.deepEqual(calls, []);
});
