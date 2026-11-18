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
    refreshing: false,
    refreshError: false,
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
    this.historyHidden = false;
    const token = getApp().getLoginToken();
    if (!token || this.historyToken !== token) this.clearPrivateData();
    this.historyToken = token;
    this.authChecking = true;
    const showVersion = (this.historyShowVersion || 0) + 1;
    this.historyShowVersion = showVersion;
    this.invalidateHistoryLoad();
    this.loadingRequestVersion = null;
    this.handlerRequestVersion = (this.handlerRequestVersion || 0) + 1;
    this.reloadAfterCurrentLoad = false;
    this.setData({ loading: false, refreshing: false, handlersLoading: false });
    const outcome = await getApp().authNavigation.restore({ target: '/pages/alarm-history/alarm-history' });
    if (showVersion !== this.historyShowVersion || this.historyHidden) return;
    this.authChecking = false;
    if (token !== getApp().getLoginToken()) {
      this.clearPrivateData();
      return;
    }
    if (outcome.type === 'ready') {
      this.setData({ isLogin: true, authRetryNeeded: false });
      return this.loadHistory(true, true, true);
    }
    if (outcome.type !== 'retryable-error') this.clearPrivateData();
    if (outcome.type === 'retryable-error') {
      this.setData({ authRetryNeeded: true, loadError: !this.data.hasLoaded, refreshError: this.data.hasLoaded });
    }
  },

  onHide() {
    this.historyHidden = true;
    this.authChecking = false;
    this.historyShowVersion = (this.historyShowVersion || 0) + 1;
    this.invalidateHistoryLoad();
    this.loadingRequestVersion = null;
    this.handlerRequestVersion = (this.handlerRequestVersion || 0) + 1;
    this.reloadAfterCurrentLoad = false;
    this.setData({ loading: false, refreshing: false, handlersLoading: false, handlerPickerVisible: false });
  },

  onUnload() {
    this.onHide();
    this.clearPrivateData();
  },

  isHistoryRequestCurrent(version, token) {
    return !this.historyHidden && version === this.historyRequestVersion && token === getApp().getLoginToken();
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
    this.historyToken = '';
    this.historyPageCount = 0;
    this.invalidateHistoryLoad();
    this.handlerRequestVersion = (this.handlerRequestVersion || 0) + 1;
    this.reloadAfterCurrentLoad = false;
    this.appliedFilters = {};
    this.setData({
      isLogin: false,
      loading: false,
      refreshing: false,
      refreshError: false,
      loadError: false,
      authRetryNeeded: false,
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

  async loadHistory(reset = false, queueIfBusy = false, preservePages = false) {
    if (!this.data.isLogin || this.historyHidden || this.data.loading) {
      if (reset && this.data.loading && queueIfBusy) {
        this.reloadAfterCurrentLoad = true;
        this.preservePagesAfterCurrentLoad = preservePages;
      }
      return;
    }
    if (!reset && (!this.data.hasMore || !this.data.nextCursor)) return;

    const requestVersion = (this.historyRequestVersion || 0) + 1;
    this.historyRequestVersion = requestVersion;
    this.loadingRequestVersion = requestVersion;
    const token = getApp().getLoginToken();
    if (!token || (this.historyToken && this.historyToken !== token)) {
      this.clearPrivateData();
      this.setData({ authRetryNeeded: true, loadError: true });
      return;
    }
    this.historyToken = token;
    let cursor = reset ? '' : this.data.nextCursor;
    const filters = this.currentFilters();
    const pagesToLoad = reset && preservePages ? Math.max(1, this.historyPageCount || 1) : 1;
    this.setData({
      loading: true,
      refreshing: reset && this.data.hasLoaded,
      refreshError: false,
      loadError: reset ? false : this.data.loadError,
      loadMoreError: false
    });

    try {
      let incoming = [];
      let hasMore = false;
      let pagesRead = 0;
      // Rebuild the previously loaded window before replacing it: keep pagination and scroll stable.
      do {
        const res = await http.get(
          '/user/alarms/history',
          buildHistoryParams(filters, cursor, PAGE_SIZE),
          { credentialScope: 'login', credential: token }
        );
        if (!this.isHistoryRequestCurrent(requestVersion, token)) return;
        const payload = res.data || {};
        incoming = mergeHistoryItems(incoming, normalizeHistoryItems(payload.items));
        cursor = payload.nextCursor == null ? '' : String(payload.nextCursor);
        hasMore = Boolean(payload.hasMore && cursor);
        pagesRead += 1;
      } while (hasMore && pagesRead < pagesToLoad);
      this.historyPageCount = reset ? pagesRead : (this.historyPageCount || 1) + pagesRead;
      this.setData({
        items: reset ? incoming : mergeHistoryItems(this.data.items, incoming),
        nextCursor: cursor,
        hasMore,
        hasLoaded: true,
        loadError: false
      });
    } catch (error) {
      if (!this.isHistoryRequestCurrent(requestVersion, token)) return;
      logger.error('加载处理历史失败', { reset, error });
      if (error && (error.code === 401 || error.code === 403)) {
        this.clearPrivateData();
        this.setData({ authRetryNeeded: error.code === 401, loadError: true });
        return;
      }
      if (reset && this.data.hasLoaded) {
        this.setData({ refreshError: true });
      } else if (reset && this.data.items.length === 0) {
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
        this.setData({ loading: false, refreshing: false });
      }
      if (this.reloadAfterCurrentLoad && !this.data.loading && this.data.isLogin && !this.historyHidden) {
        this.reloadAfterCurrentLoad = false;
        await this.loadHistory(true, true, this.preservePagesAfterCurrentLoad);
      }
    }
  },

  retryLoad() {
    if (this.data.authRetryNeeded) {
      this.onShow();
      return;
    }
    this.loadHistory(this.data.refreshError || this.data.items.length === 0, true, this.data.refreshError);
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
    const token = getApp().getLoginToken();
    const requestVersion = (this.handlerRequestVersion || 0) + 1;
    this.handlerRequestVersion = requestVersion;
    this.setData({ handlersLoading: true, handlersLoadError: false });
    try {
      const res = await http.get('/user/alarms/history/handlers', {
        keyword: String(keyword || '').trim(),
        limit: 20
      }, { credentialScope: 'login', credential: token });
      if (requestVersion !== this.handlerRequestVersion || this.historyHidden || token !== getApp().getLoginToken()) return;
      this.setData({ handlers: normalizeHandlers(res.data) });
    } catch (error) {
      if (requestVersion !== this.handlerRequestVersion || this.historyHidden || token !== getApp().getLoginToken()) return;
      logger.error('加载处理人选项失败', { error });
      if (error && (error.code === 401 || error.code === 403)) {
        this.clearPrivateData();
        this.setData({ authRetryNeeded: error.code === 401, loadError: true });
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
    this.setData({ hasActiveFilters, filtersExpanded: false, items: [], nextCursor: '', hasMore: false, hasLoaded: false });
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
      hasLoaded: false,
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
