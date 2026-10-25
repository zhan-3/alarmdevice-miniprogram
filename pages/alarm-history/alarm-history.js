import http from '../../utils/http';
import logger from '../../utils/logger';
const {
  normalizeHistoryItems,
  mergeHistoryItems,
  buildHistoryParams,
  isValidDateRange,
  normalizeHandlers
} = require('../../utils/alarmHistory');

const PAGE_SIZE = 20;

Page({
  data: {
    isLogin: false,
    items: [],
    loading: false,
    loadError: false,
    loadMoreError: false,
    hasMore: false,
    nextCursor: '',
    hasLoaded: false,
    authRetryNeeded: false,
    filtersExpanded: false,
    keywordInput: '',
    startDate: '',
    endDate: '',
    selectedHandlerId: '',
    selectedHandlerName: '',
    hasActiveFilters: false,
    handlerPickerVisible: false,
    handlerKeyword: '',
    handlers: [],
    handlersLoading: false,
    handlersLoadError: false
  },

  async onShow() {
    if (this.authChecking) return;
    this.authChecking = true;
    this.invalidateHistoryLoad();
    this.handlerRequestVersion = (this.handlerRequestVersion || 0) + 1;
    this.reloadAfterCurrentLoad = false;
    this.clearHistoryResults();
    this.setData({ handlers: [], handlersLoading: false, handlersLoadError: false });
    const outcome = await getApp().authNavigation.restore({ target: '/pages/alarm-history/alarm-history' });
    this.authChecking = false;
    if (outcome.type === 'ready') {
      this.setData({ isLogin: true, authRetryNeeded: false });
      return this.loadHistory(true, true);
    }

    this.clearPrivateData();
    if (outcome.type === 'retryable-error') {
      this.setData({ authRetryNeeded: true, loadError: true });
    }
  },

  invalidateHistoryLoad() {
    this.historyRequestVersion = (this.historyRequestVersion || 0) + 1;
  },

  clearHistoryResults() {
    this.setData({
      items: [],
      nextCursor: '',
      hasMore: false,
      hasLoaded: false,
      loadError: false,
      loadMoreError: false
    });
  },

  clearPrivateData() {
    this.invalidateHistoryLoad();
    this.handlerRequestVersion = (this.handlerRequestVersion || 0) + 1;
    this.reloadAfterCurrentLoad = false;
    this.appliedFilters = {};
    this.setData({
      isLogin: false,
      items: [],
      nextCursor: '',
      hasMore: false,
      hasLoaded: false,
      loadMoreError: false,
      handlers: [],
      handlersLoading: false,
      handlerPickerVisible: false,
      selectedHandlerId: '',
      selectedHandlerName: '',
      handlerKeyword: '',
      keywordInput: '',
      startDate: '',
      endDate: '',
      hasActiveFilters: false
    });
  },

  currentFilters() {
    return this.appliedFilters || {};
  },

  async loadHistory(reset = false, queueIfBusy = false) {
    if (!this.data.isLogin || this.data.loading) {
      if (reset && this.data.loading && queueIfBusy) this.reloadAfterCurrentLoad = true;
      return;
    }
    if (!reset && (!this.data.hasMore || !this.data.nextCursor)) return;

    const requestVersion = (this.historyRequestVersion || 0) + 1;
    this.historyRequestVersion = requestVersion;
    this.loadingRequestVersion = requestVersion;
    const cursor = reset ? '' : this.data.nextCursor;
    this.setData({
      loading: true,
      loadError: reset ? false : this.data.loadError,
      loadMoreError: false
    });

    try {
      const res = await http.get(
        '/user/alarms/history',
        buildHistoryParams(this.currentFilters(), cursor, PAGE_SIZE),
        { credentialScope: 'login' }
      );
      if (requestVersion !== this.historyRequestVersion) return;
      const payload = res.data || {};
      const incoming = normalizeHistoryItems(payload.items);
      const nextCursor = payload.nextCursor === null || typeof payload.nextCursor === 'undefined'
        ? ''
        : String(payload.nextCursor);
      this.setData({
        items: reset ? incoming : mergeHistoryItems(this.data.items, incoming),
        nextCursor,
        hasMore: Boolean(payload.hasMore && nextCursor),
        hasLoaded: true,
        loadError: false
      });
    } catch (error) {
      if (requestVersion !== this.historyRequestVersion) return;
      logger.error('加载处理历史失败', { reset, error });
      if (error && error.code === 401) {
        this.clearPrivateData();
        this.setData({ authRetryNeeded: true, loadError: true });
        return;
      }
      if (reset && this.data.items.length === 0) {
        this.setData({ loadError: true, hasLoaded: true });
      } else {
        this.setData({ loadMoreError: true });
        if (!error || !error.userNotified) {
          wx.showToast({ title: '加载更多失败，请重试', icon: 'none' });
        }
      }
    } finally {
      if (this.loadingRequestVersion === requestVersion) {
        this.loadingRequestVersion = null;
        this.setData({ loading: false });
      }
      if (this.reloadAfterCurrentLoad && !this.data.loading && this.data.isLogin) {
        this.reloadAfterCurrentLoad = false;
        await this.loadHistory(true, true);
      }
    }
  },

  retryLoad() {
    if (this.data.authRetryNeeded) {
      this.onShow();
      return;
    }
    this.loadHistory(this.data.items.length === 0);
  },

  onPullDownRefresh() {
    if (this.data.authRetryNeeded) {
      this.onShow().finally(() => wx.stopPullDownRefresh());
      return;
    }
    this.invalidateHistoryLoad();
    this.loadHistory(true, true).finally(() => wx.stopPullDownRefresh());
  },

  onReachBottom() {
    this.loadHistory(false);
  },

  toggleFilters() {
    const filtersExpanded = !this.data.filtersExpanded;
    this.setData({ filtersExpanded });
    if (filtersExpanded && this.data.handlers.length === 0) this.loadHandlers('');
  },

  onKeywordInput(e) {
    this.setData({ keywordInput: e.detail.value });
  },

  onStartDateChange(e) {
    this.setData({ startDate: e.detail.value });
  },

  onEndDateChange(e) {
    this.setData({ endDate: e.detail.value });
  },

  clearStartDate() {
    this.setData({ startDate: '' });
  },

  clearEndDate() {
    this.setData({ endDate: '' });
  },

  openHandlerPicker() {
    this.setData({ handlerPickerVisible: true });
    if (this.data.handlers.length === 0) this.loadHandlers('');
  },

  closeHandlerPicker() {
    this.setData({ handlerPickerVisible: false });
  },

  onHandlerSearchInput(e) {
    this.setData({ handlerKeyword: e.detail.value });
  },

  searchHandlers() {
    this.loadHandlers(this.data.handlerKeyword);
  },

  async loadHandlers(keyword = '') {
    if (this.data.handlersLoading) return;
    const requestVersion = (this.handlerRequestVersion || 0) + 1;
    this.handlerRequestVersion = requestVersion;
    this.setData({ handlersLoading: true, handlersLoadError: false });
    try {
      const res = await http.get('/user/alarms/history/handlers', {
        keyword: String(keyword || '').trim(),
        limit: 20
      }, { credentialScope: 'login' });
      if (requestVersion !== this.handlerRequestVersion) return;
      this.setData({ handlers: normalizeHandlers(res.data) });
    } catch (error) {
      if (requestVersion !== this.handlerRequestVersion) return;
      logger.error('加载处理人选项失败', { error });
      if (error && error.code === 401) {
        this.clearPrivateData();
        return;
      }
      this.setData({ handlersLoadError: true });
    } finally {
      if (requestVersion === this.handlerRequestVersion) this.setData({ handlersLoading: false });
    }
  },

  selectHandler(e) {
    this.setData({
      selectedHandlerId: String(e.currentTarget.dataset.id || ''),
      selectedHandlerName: String(e.currentTarget.dataset.name || ''),
      handlerPickerVisible: false
    });
  },

  clearHandler() {
    this.setData({ selectedHandlerId: '', selectedHandlerName: '', handlerPickerVisible: false });
  },

  applyFilters() {
    if (!isValidDateRange(this.data.startDate, this.data.endDate)) {
      wx.showToast({ title: '开始日期不能晚于结束日期', icon: 'none' });
      return;
    }
    this.appliedFilters = {
      keyword: String(this.data.keywordInput || '').trim(),
      startDate: this.data.startDate,
      endDate: this.data.endDate,
      handlerId: this.data.selectedHandlerId
    };
    const hasActiveFilters = Boolean(
      this.appliedFilters.keyword || this.appliedFilters.startDate ||
      this.appliedFilters.endDate || this.appliedFilters.handlerId
    );
    this.invalidateHistoryLoad();
    this.setData({ hasActiveFilters, filtersExpanded: false, items: [], nextCursor: '', hasMore: false });
    this.loadHistory(true, true);
  },

  clearFilters() {
    this.appliedFilters = {};
    this.invalidateHistoryLoad();
    this.setData({
      keywordInput: '',
      startDate: '',
      endDate: '',
      selectedHandlerId: '',
      selectedHandlerName: '',
      hasActiveFilters: false,
      filtersExpanded: false,
      items: [],
      nextCursor: '',
      hasMore: false
    });
    this.loadHistory(true, true);
  },

  openDetail(e) {
    const alarmId = String(e.currentTarget.dataset.id || '');
    if (!alarmId) return;
    wx.navigateTo({
      url: `/pages/alarm-history-detail/alarm-history-detail?alarmId=${encodeURIComponent(alarmId)}`
    });
  }
});
