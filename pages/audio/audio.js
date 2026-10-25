import { setStorage, getStorage } from '../../utils/storage'
import http from '../../utils/http'
import logger from '../../utils/logger'
const {
  normalizeCollectIds,
  filterAndSortAudio,
  findAudioById,
  rebuildAudioList,
  toggleAudioCollection
} = require('../../utils/audioState')

Page({
  data: {
    currentAudio: null,
    isPlaying: false,
    progress: 0,
    currentTime: '00:00',
    playbackRate: 1,
    audioList: [],
    audioManager: null,
    currentPlayId: '',
    audioTotalTime: 0,
    audioCurrentTime: 0,
    isDragging: false,
    showPlayerBar: false,
    playState: 'pause',
    progressTimer: null,
    formatCurrent: '00:00',
    formatTotal: '01:00',
    sortType: 'desc',
    filterType: 'all',
    filteredList: [],
    showActionSheet: false,
    selectedItem: null
  },
  timer: null,
  loadTimeoutTimer: null,

  onLoad() {
    this.initAudioManager();
    setTimeout(() => {
      this.data.audioManager && this.setupAudioListeners();
    }, 50);
  },

  onShow() {
    this.startPollingRealData();
  },

  onHide() {
    this.stopPolling();
    this.clearProgressTimer();
    if (this.data.audioManager && this.data.isPlaying) {
      this.data.audioManager.pause();
    }
  },

  onUnload() {
    this.stopPolling();
    this.clearProgressTimer();
    this.loadTimeoutTimer && clearTimeout(this.loadTimeoutTimer);
    // 销毁音频管理器
    if (this.data.audioManager) {
      try { this.data.audioManager.destroy(); } catch (e) { /* noop */ }
      this.setData({ audioManager: null });
    }
  },

  formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  },

  setSpeed(e) {
    const rate = parseFloat(e.currentTarget.dataset.rate);
    this.setData({ playbackRate: rate });
    // InnerAudioContext的倍速设置
    if (this.data.audioManager) {
      this.data.audioManager.setPlaybackRate(rate);
    }
  },

  // 初始化音频管理器（基于 InnerAudioContext 封装统一接口）
  initAudioManager() {
    const innerAudio = wx.createInnerAudioContext();
    innerAudio.obeyMuteSwitch = false;
    innerAudio.volume = 1;

    // 事件名首字母大写，匹配微信 API：on + 'Play' = 'onPlay'
    const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

    const audioManager = {
      _ctx: innerAudio,
      play:            () => innerAudio.play(),
      pause:           () => innerAudio.pause(),
      stop:            () => innerAudio.stop(),
      seek:            (time) => innerAudio.seek(time),
      setPlaybackRate: (rate) => { innerAudio.playbackRate = rate; },
      getDuration:     () => innerAudio.duration || 0,
      getCurrentTime:  () => innerAudio.currentTime || 0,
      destroy:         () => innerAudio.destroy(),
      load:            (url) => {
        if (innerAudio.src === url) return;
        innerAudio.src = url;
      },
      on: (evt, cb) => {
        const method = 'on' + capitalize(evt);
        if (typeof innerAudio[method] === 'function') {
          innerAudio[method](cb);
        } else {
          logger.warn('音频管理器收到不支持的事件', { event: evt });
        }
      },
      off: (evt, cb) => {
        const method = 'off' + capitalize(evt);
        if (typeof innerAudio[method] === 'function') {
          innerAudio[method](cb);
        }
      }
    };

    this.setData({ audioManager });

  },

  // ========== 完全保留你原有的数据处理/接口逻辑 ==========
  startPollingRealData() {
    this.getAllDeviceRecord();
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => this.getAllDeviceRecord(), 15000);
  },

  stopPolling() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  },

  getAllDeviceRecord() {
    if (this.isLoadingRecords) return;
    this.isLoadingRecords = true;
    const app = getApp();
    const deviceId = app.globalData.selectedDeviceSn;
    if (!deviceId) {
      this.isLoadingRecords = false;
      this.setData({ audioList: [], filteredList: [] });
      return;
    }
    http.get("/user/getRecord", { deviceId }, {
      credentialScope: 'login',
      deviceId
    })
      .then(res => {
        if (deviceId !== app.globalData.selectedDeviceSn) return;
        if ( res.code !== 1) {
          const errMsg = res.msg || '获取数据失败';
          res.code !== 200 && wx.toast({ title: errMsg, icon: 'error', duration: 2000 });
          return;
        }
        
        const hiddenRecordUrls = normalizeCollectIds(getStorage('hiddenRecordUrls', []));
        const audioUrlList = (Array.isArray(res.data) ? res.data : [])
          .filter(url => url && !hiddenRecordUrls.includes(url));
        if (!audioUrlList.length) {
          this.setData({ audioList: [], filteredList: [] });
          return;
        }

        const rebuilt = rebuildAudioList({
          urls: audioUrlList,
          currentItems: this.data.audioList,
          collectIds: getStorage('collectIds', []),
          currentPlayId: this.data.currentPlayId,
          isPlaying: this.data.isPlaying,
          nextId: this._audioIdGen || 0
        });
        this._audioIdGen = rebuilt.nextId;
        const resList = rebuilt.items;

        // 脏检查：数据没变化就不 setData
        if (JSON.stringify(resList) !== JSON.stringify(this.data.audioList)) {
          this.setData({ audioList: resList });
        }
        this.updateFilteredList();
      })
      .catch(err => {
        if (err && (err.code === 401 || err.code === 403)) this.setData({ audioList: [], filteredList: [] });
        logger.error('音频列表请求失败', { error: err });
      })
      .finally(() => {
        this.isLoadingRecords = false;
      });
  },

  updateFilteredList(srcList) {
    const list = filterAndSortAudio(
      srcList || this.data.audioList,
      this.data.filterType,
      this.data.sortType
    );
    if (JSON.stringify(this.data.filteredList) !== JSON.stringify(list)) {
      this.setData({ filteredList: list });
    }
  },

  toggleSort() {
    const sortType = this.data.sortType === 'desc' ? 'asc' : 'desc';
    this.setData({ sortType });
    this.updateFilteredList();
  },

  toggleFilter() {
    const types = ['all', 'emergency', 'collected'];
    const currentIndex = types.indexOf(this.data.filterType);
    const nextIndex = (currentIndex + 1) % types.length;
    this.setData({ filterType: types[nextIndex] });
    this.updateFilteredList();
  },

  showActionMenu(e) {
    const { id } = e.currentTarget.dataset;
    const index = this.data.audioList.findIndex(a => a.id === id);
    const item = this.data.audioList[index] || null;
    this.setData({
      showActionSheet: true,
      selectedItem: item
    });
  },

  hideActionMenu() {
    this.setData({
      showActionSheet: false,
      selectedItem: null
    });
  },

  playSelected() {
    if (this.data.selectedItem) {
      this.selectAudio({ currentTarget: { dataset: { id: this.data.selectedItem.id } } });
    }
    this.hideActionMenu();
  },

  // 音频事件监听
  setupAudioListeners() {
    const audioManager = this.data.audioManager;
    if (!audioManager) return;

    // 错误监听
    audioManager.on('error', (err) => {
      err = err || {};
      const nativeErrorMessage = String(err.errMsg || err.message || '');
      const isIdleOperationFailure = !this.data.isPlaying &&
        /(?:operateAudio:fail:)?(?:pause|stop) audio fail/i.test(nativeErrorMessage);
      if (isIdleOperationFailure) {
        logger.warn('忽略空闲音频操作失败', { error: err });
        return;
      }

      logger.error('音频播放失败', { error: err });
      const errMsgMap = {
        10001: '系统错误（音频服务异常）',
        10002: '网络错误（音频地址无法访问）',
        10003: '文件错误（音频文件不存在/损坏）',
        10004: '格式错误（不支持的音频格式）',
        '-1': '未知错误（请检查音频地址或网络）'
      };
      const errCode = err.errCode || err.code || -1;
      const errMsg = errMsgMap[errCode] || `未知错误（错误码：${errCode}）`;

      wx.toast({ title: errMsg, icon: 'none', duration: 3000 });
      // onError 内不再调用 stop 或清空 src，避免原生操作失败再次触发 onError。
      this.resetPlayState(true, false);
      this.setData({ currentTime: '00:00', progress: 0 });
    });

    // 播放监听（InnerAudioContext）
    audioManager.on('play', () => {
      this.setData({ isPlaying: true, playState: 'play' });
      this.startProgressTimer();
    });

    // 暂停监听（InnerAudioContext）
    audioManager.on('pause', () => {
      this.setData({ isPlaying: false, playState: 'pause' });
      this.clearProgressTimer();
    });

    // 停止监听（InnerAudioContext）
    audioManager.on('stop', () => {
      this.setData({ 
        isPlaying: false,
        progress: 0,
        currentTime: '00:00',
        playState: 'pause'
      });
      this.clearProgressTimer();
    });

    // 进度更新（InnerAudioContext 的 onTimeUpdate 回调无参数，需从实例读取）
    audioManager.on('timeUpdate', () => {
      const curTime = audioManager.getCurrentTime();
      const dur = audioManager.getDuration();
      if (this.data.isDragging || !dur) return;
      const progress = (curTime / dur) * 100;
      const currentTime = this.formatTime(curTime);
      this.setData({
        progress,
        currentTime,
        audioTotalTime: Math.floor(dur),
        formatTotal: this.formatTime(dur)
      });
    });

    // 播放结束（InnerAudioContext）
    audioManager.on('ended', () => {
      this.setData({ 
        isPlaying: false,
        progress: 100,
        currentTime: this.formatTime(this.data.audioManager.getDuration())
      });
      this.resetPlayState(true);
    });
  },

  // ========== 适配：选择音频（替换原生src为NPM包load） ==========
  selectAudio(e) {
    const audioId = e.currentTarget.dataset.id;
    const audio = findAudioById(this.data.audioList, audioId);
    if (!audio) return;
    const index = this.data.audioList.findIndex(item => item.id === audioId);

    // 保留你原有的重置逻辑
    if (this.data.audioManager) {
      if (this.data.isPlaying) this.data.audioManager.pause();
      this.clearProgressTimer();
      this.data.audioManager.off('canplay'); // 移除旧的监听
    }

    this.setData({
      currentAudio: audio,
      isPlaying: false,
      progress: 0,
      currentTime: '00:00',
      currentPlayId: audio.id
    });

    this.updateFilteredList();

    wx.showLoading({ title: '加载音频中...' });
    this.data.audioManager.load(audio.url);

    const onCanplay = () => {
      wx.hideLoading();
      const realDuration = this.formatTime(this.data.audioManager.getDuration());
      const newAudioList = [...this.data.audioList];
      newAudioList[index].duration = realDuration;
      this.setData({
        formatTotal: realDuration,
        audioTotalTime: Math.floor(this.data.audioManager.getDuration()),
        audioList: newAudioList
      });
      this.data.audioManager.off('canplay', onCanplay);
    };
    this.data.audioManager.on('canplay', onCanplay);
    setTimeout(() => wx.hideLoading(), 1000);
  },

  // ========== 适配：播放/暂停切换（InnerAudioContext方法） ==========
  togglePlay() {
    if (!this.data.currentAudio || !this.data.audioManager) {
      wx.toast({ title: '暂无可播放音频', icon: 'none' }); 
      return;
    }

    const { url, id } = this.data.currentAudio;
    const { isPlaying, playbackRate } = this.data;

    if (!isPlaying) {
      // 选中录音时已经设置过 src。重复 stop + 重设同一地址会中断首次加载，
      // 部分微信客户端会先触发一次可恢复的 onError，随后又正常播放。
      this.data.audioManager.load(url);
      this.data.audioManager.setPlaybackRate(playbackRate || 1);

      // 保留超时定时器逻辑
      if (this.loadTimeoutTimer) {
        clearTimeout(this.loadTimeoutTimer);
        this.loadTimeoutTimer = null;
      }
      this.loadTimeoutTimer = setTimeout(() => {
        wx.hideLoading();
        wx.toast({ title: '音频加载超时，请检查网络', icon: 'none' });
        this.resetPlayState(true);
      }, 20000);

      // InnerAudioContext的播放逻辑
      const playAudio = () => {
        if (this.loadTimeoutTimer) {
          clearTimeout(this.loadTimeoutTimer);
          this.loadTimeoutTimer = null;
        }

        try {
          this.data.audioManager.play();
          this.setData({
            currentPlayId: id,
            isPlaying: true,
            playState: 'play'
          });
          this.startProgressTimer();
        } catch (err) {
          logger.error('音频播放触发失败', { error: err });
          wx.toast({ title: '播放失败，请点击重试', icon: 'none' });
        }
      };

      // InnerAudioContext 支持在资源尚未完成加载时调用 play；客户端会在就绪后自动开始。
      // 不等待 canplay，避免该事件在监听器注册前已经触发而吞掉第一次点击。
      playAudio();

    } else {
      // 暂停逻辑（InnerAudioContext）
      this.data.audioManager.pause(); // 替换原生pause
      this.setData({
        isPlaying: false,
        playState: 'pause'
      });
      this.clearProgressTimer();
    }
  },

  // 控制逻辑
  previousAudio() {
    if (!this.data.currentAudio) return;
    const currentIndex = this.data.audioList.findIndex(
      item => item.id === this.data.currentAudio.id
    );
    if (currentIndex > 0) {
      this.selectAudio({
        currentTarget: { dataset: { id: this.data.audioList[currentIndex - 1].id } }
      });
    }
  },

  nextAudio() {
    if (!this.data.currentAudio) return;
    const currentIndex = this.data.audioList.findIndex(
      item => item.id === this.data.currentAudio.id
    );
    if (currentIndex < this.data.audioList.length - 1) {
      this.selectAudio({
        currentTarget: { dataset: { id: this.data.audioList[currentIndex + 1].id } }
      });
    }
  },

  onSliderChanging(e) {
    this.setData({ 
      progress: e.detail.value,
      isDragging: true 
    });
  },

  onSliderChange(e) {
    if (!this.data.audioManager || !this.data.audioManager.getDuration()) return;
    const value = e.detail.value;
    const newTime = (value / 100) * this.data.audioManager.getDuration();
    this.data.audioManager.seek(newTime); // InnerAudioContext的seek
    this.setData({ 
      progress: value,
      isDragging: false 
    });
  },

  // 原有定时器/状态重置逻辑
  startProgressTimer() {
    if (this.data.progressTimer) clearInterval(this.data.progressTimer);
    const timer = setInterval(() => {
      const audioManager = this.data.audioManager;
      const data = this.data;
      if (!audioManager || data.isDragging || data.playState === 'pause' || !data.currentPlayId) return;
      const currentTime = Math.floor(audioManager.getCurrentTime()) || 0; // InnerAudioContext
      let totalTime = Math.floor(audioManager.getDuration()) || data.audioTotalTime || 60;
      let progressRatio = (currentTime / totalTime) * 100;
      progressRatio = Math.max(0, Math.min(100, progressRatio));
      this.setData({
        progress: progressRatio,
        currentTime: this.formatTime(currentTime),
        formatCurrent: this.formatTime(currentTime),
        formatTotal: this.formatTime(totalTime)
      });
      if (currentTime >= totalTime) {
        clearInterval(timer);
        this.setData({ progressTimer: null });
        this.resetPlayState(true);
      }
    }, 1000);
    this.setData({ progressTimer: timer });
  },

  clearProgressTimer() {
    if (this.data.progressTimer) {
      clearInterval(this.data.progressTimer);
      this.setData({ progressTimer: null });
    }
  },

  resetPlayState(clearSrc = false, operateAudio = true) {
    const { audioList, currentPlayId } = this.data;
    if (!this.data.audioManager || !currentPlayId) return;

    const newList = [...audioList].map(item => ({
      ...item,
      isPlaying: item.id === currentPlayId ? false : item.isPlaying
    }));
    this.setData({ audioList: newList, isPlaying: false });

    if (operateAudio) this.data.audioManager.stop();
    // 不向 InnerAudioContext 写入空 src；微信会把它作为新的文件错误并再次触发 onError。
    if (clearSrc) {
      this.setData({ 
        currentTime: '00:00', 
        progress: 0, 
        currentPlayId: '',
        playState: 'pause',
        isDragging: false
      });
      this.clearProgressTimer();
    }
  },

  // ========== 收藏功能 ==========
  quickCollect(e) {
    const currentId = e.currentTarget.dataset.id;
    if (!currentId) return;

    const result = toggleAudioCollection(
      this.data.audioList,
      getStorage('collectIds', []),
      currentId
    );
    if (!result) return;

    setStorage('collectIds', result.collectIds);
    this.setData({ audioList: result.items });
    this.updateFilteredList(result.items);
    wx.toast({ title: result.isCollected ? '已收藏' : '已取消', icon: 'none' });
  },

  collectRecord(e) {
    const currentId = e && e.currentTarget && e.currentTarget.dataset.id
      ? e.currentTarget.dataset.id
      : this.data.selectedItem && this.data.selectedItem.id;
    if (!currentId) return;

    const result = toggleAudioCollection(
      this.data.audioList,
      getStorage('collectIds', []),
      currentId
    );
    if (!result) return;

    setStorage('collectIds', result.collectIds);
    this.setData({ audioList: result.items });
    this.updateFilteredList(result.items);
    wx.toast({
      title: result.isCollected ? '收藏成功' : '已取消',
      icon: result.isCollected ? 'success' : 'none'
    });
    this.hideActionMenu();
  },

  async delHandler(e) {
    let currentId;
    if (e && e.currentTarget && e.currentTarget.dataset.id) {
      currentId = e.currentTarget.dataset.id;
    } else {
      currentId = this.data.selectedItem?.id;
    }

    const { audioList, currentAudio } = this.data;
    const index = audioList.findIndex(item => item.id === currentId);
    const target = audioList[index];

    if (index === -1 || !currentId || !target) return wx.toast({ title: '数据不存在' });

    this.hideActionMenu();
    const confirmed = await wx.modal({
      title: '从列表移除',
      content: '移除后此设备上的录音将不再显示。'
    });
    if (confirmed) {
      const newList = audioList.filter(item => item.id !== currentId);
      const collectIds = normalizeCollectIds(getStorage('collectIds', []))
        .filter(id => id !== currentId);
      const hiddenRecordUrls = normalizeCollectIds(getStorage('hiddenRecordUrls', []));
      setStorage('collectIds', collectIds);
      setStorage('hiddenRecordUrls', [...new Set([...hiddenRecordUrls, target.url])]);

      const removedCurrent = currentAudio && currentAudio.id === currentId;
      if (removedCurrent && this.data.audioManager) {
        this.data.audioManager.stop();
        this.clearProgressTimer();
      }

      this.setData({
        audioList: newList,
        currentAudio: removedCurrent ? null : currentAudio,
        currentPlayId: removedCurrent ? '' : this.data.currentPlayId,
        isPlaying: removedCurrent ? false : this.data.isPlaying,
        playState: removedCurrent ? 'pause' : this.data.playState
      });
      this.updateFilteredList(newList);
      wx.toast({ title: '已从列表移除', icon: 'success' });
    }
  }
});