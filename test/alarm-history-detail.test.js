const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadDetailPage({ http, wx, app, logger = { error() {} } }) {
  const pagePath = path.join(__dirname, '../pages/alarm-history-detail/alarm-history-detail.js');
  const source = fs.readFileSync(pagePath, 'utf8')
    .replace("import http from '../../utils/http';", 'const http = globalThis.__deps.http;')
    .replace("import logger from '../../utils/logger';", 'const logger = globalThis.__deps.logger;')
    .replace("import { env } from '../../utils/env';", 'const env = globalThis.__deps.env;');
  let definition;
  vm.runInNewContext(source, {
    __deps: { http, logger, env: { baseURL: 'https://api.example.test' } },
    Page(value) { definition = value; },
    wx,
    getApp() { return app; },
    require(request) {
      if (request.endsWith('/alarmHistory')) return require('../utils/alarmHistory');
      throw new Error(`Unexpected require: ${request}`);
    },
    console,
    Promise,
    String,
    Boolean,
    Number,
    Date,
    Set,
    Map,
    Array,
    encodeURIComponent
  }, { filename: pagePath });
  return definition;
}

function createPage(definition, data = {}) {
  return {
    ...definition,
    data: { ...definition.data, ...data },
    setData(update) { Object.assign(this.data, update); }
  };
}

test('revalidates detail on every show and clears data after an unbind 404', async () => {
  let requests = 0;
  const definition = loadDetailPage({
    wx: {},
    app: {
      authNavigation: { async restore() { return { type: 'ready' }; } }
    },
    http: {
      async get() {
        requests += 1;
        if (requests === 1) return { data: { alarmId: '42', status: 'handled' } };
        throw { code: 404 };
      }
    }
  });
  const page = createPage(definition, { alarmId: '42' });

  await page.onShow();
  assert.equal(page.data.item.alarmId, '42');
  await page.onShow();

  assert.equal(requests, 2);
  assert.equal(page.data.item, null);
  assert.equal(page.data.unavailable, true);
});

test('clears detail and downloaded recording when authentication fails', async () => {
  let destroyed = 0;
  let aborted = 0;
  const unlinkedPaths = [];
  const definition = loadDetailPage({
    wx: {
      getFileSystemManager() {
        return { unlink(options) { unlinkedPaths.push(options.filePath); } };
      }
    },
    app: {
      authNavigation: { async restore() { return { type: 'login-required' }; } }
    },
    http: { async get() { throw new Error('must not request'); } }
  });
  const page = createPage(definition, {
    alarmId: '42',
    item: { alarmId: '42', fileId: 'private-file' },
    recordingPath: 'wxfile://private.mp3',
    recordingPlaying: true
  });
  page.recordingAudio = { destroy() { destroyed += 1; } };
  page.recordingDownloadTask = { abort() { aborted += 1; } };

  page.onHide();
  await page.onShow();

  assert.equal(page.data.item, null);
  assert.equal(page.data.recordingPath, '');
  assert.equal(page.data.recordingPlaying, false);
  assert.equal(destroyed, 1);
  assert.equal(aborted, 1);
  assert.deepEqual(unlinkedPaths, ['wxfile://private.mp3']);
});

test('downloads protected recording with an Authorization header before playback', async () => {
  const downloads = [];
  const unlinkedPaths = [];
  const audioCalls = [];
  const handlers = {};
  const audio = {
    set src(value) { audioCalls.push(['src', value]); },
    set obeyMuteSwitch(value) { audioCalls.push(['mute', value]); },
    onPlay(callback) { handlers.play = callback; },
    onPause(callback) { handlers.pause = callback; },
    onEnded(callback) { handlers.ended = callback; },
    onError(callback) { handlers.error = callback; },
    play() { audioCalls.push(['play']); handlers.play(); },
    pause() { audioCalls.push(['pause']); handlers.pause(); },
    destroy() { audioCalls.push(['destroy']); }
  };
  let staleDownloadSuccess;
  const wx = {
    downloadFile(options) {
      downloads.push(options);
      if (downloads.length === 1) {
        options.success({ statusCode: 200, tempFilePath: 'wxfile://tmp/alarm.mp3' });
      } else {
        staleDownloadSuccess = options.success;
      }
      return { abort() {} };
    },
    createInnerAudioContext() { return audio; },
    getFileSystemManager() {
      return { unlink(options) { unlinkedPaths.push(options.filePath); } };
    },
    showToast() {}
  };
  const definition = loadDetailPage({
    wx,
    app: { getLoginToken: () => 'login-secret' },
    http: {}
  });
  const page = createPage(definition, {
    alarmId: 'alarm/42',
    item: { alarmId: 'alarm/42', fileId: 'private-file' }
  });

  await page.toggleRecording();

  assert.equal(downloads[0].url, 'https://api.example.test/user/alarms/history/alarm%2F42/recording');
  assert.equal(downloads[0].header.Authorization, 'Bearer login-secret');
  assert.equal(downloads[0].url.includes('token='), false);
  assert.equal(page.data.recordingPath, 'wxfile://tmp/alarm.mp3');
  assert.equal(page.data.recordingPlaying, true);
  assert.equal(audioCalls.some(call => call[0] === 'play'), true);

  page.onHide();
  assert.equal(page.data.recordingPath, '');
  assert.equal(page.data.recordingPlaying, false);
  assert.deepEqual(unlinkedPaths, ['wxfile://tmp/alarm.mp3']);

  page.setData({ item: { alarmId: 'alarm/42', fileId: 'private-file' } });
  const staleDownload = page.toggleRecording();
  page.onHide();
  staleDownloadSuccess({ statusCode: 200, tempFilePath: 'wxfile://tmp/orphan.mp3' });
  await staleDownload;

  assert.deepEqual(unlinkedPaths, ['wxfile://tmp/alarm.mp3', 'wxfile://tmp/orphan.mp3']);
  assert.equal(page.data.recordingPath, '');
});
