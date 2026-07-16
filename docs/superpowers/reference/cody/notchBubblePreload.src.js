const { ipcRenderer, contextBridge } = require('electron');
const { safeIpcSend } = require('./safe-ipc-send');

const FALLBACK_BRAND = {
  name: 'Perssua',
  icon: '/assets/icon.png',
  wordmark: '/assets/perssua_logo.svg',
  iconFilePath: null,
  iconUrl: '/assets/icon.png',
  theme: null,
};

const FALLBACK_FLAVOR_FEATURES = {
  fastFirstInsight: false,
};

const getBrand = async () => {
  try {
    return await ipcRenderer.invoke('notch-bubble:get-brand') || FALLBACK_BRAND;
  } catch (_) {
    return FALLBACK_BRAND;
  }
};

const getFlavorFeatures = async () => {
  try {
    return await ipcRenderer.invoke('notch-bubble:get-flavor-features') || FALLBACK_FLAVOR_FEATURES;
  } catch (_) {
    return FALLBACK_FLAVOR_FEATURES;
  }
};

contextBridge.exposeInMainWorld('notchAPI', {
  getBrand,
  getFlavorFeatures,
  onUpdate: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('notch-bubble:update', handler);
    return () => ipcRenderer.removeListener('notch-bubble:update', handler);
  },
  onCollapse: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('notch-bubble:collapse', handler);
    return () => ipcRenderer.removeListener('notch-bubble:collapse', handler);
  },
  setIgnoreMouseEvents: (ignore, options) => {
    safeIpcSend('notch-bubble:set-ignore-mouse', ignore, options);
  },
  setShape: (rects) => {
    safeIpcSend('notch-bubble:set-shape', rects);
  },
  sendSkip: () => {
    safeIpcSend('notch-bubble:skipped');
  },
  requestFollowUps: (payload) => {
    safeIpcSend('notch-bubble:follow-up-options-requested', payload);
  },
  sendFollowUpClick: (payload) => {
    safeIpcSend('notch-bubble:follow-up-clicked', payload);
  },
  sendErrorAction: (payload) => {
    safeIpcSend('notch-bubble:error-action', payload);
  },
  sendSensitivityChange: (value) => {
    safeIpcSend('notch-bubble:sensitivity-change', value);
  },
  sendCaptureSelectionChange: (enabled) => {
    safeIpcSend('notch-bubble:capture-selection-change', enabled);
  },
  sendModeChange: (mode) => {
    safeIpcSend('notch-bubble:mode-change', mode);
  },
  sendResponseLanguageChange: (value) => {
    safeIpcSend('notch-bubble:response-language-change', value);
  },
  requestSettings: () => {
    safeIpcSend('notch-bubble:request-settings');
  },
  onSettingsUpdate: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('notch-bubble:update-settings', handler);
    return () => ipcRenderer.removeListener('notch-bubble:update-settings', handler);
  },
  onScrollShortcut: (callback) => {
    const handler = (_event, direction) => callback(direction);
    ipcRenderer.on('notch-bubble:scroll', handler);
    return () => ipcRenderer.removeListener('notch-bubble:scroll', handler);
  },
  onHistoryShortcut: (callback) => {
    const handler = (_event, direction) => callback(direction);
    ipcRenderer.on('notch-bubble:navigate-history', handler);
    return () => ipcRenderer.removeListener('notch-bubble:navigate-history', handler);
  },
  onReset: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('notch-bubble:reset', handler);
    return () => ipcRenderer.removeListener('notch-bubble:reset', handler);
  },
  moveWindow: (x, y) => {
    safeIpcSend('notch-bubble:move', x, y);
  },
  resizeWindow: (width, height) => {
    safeIpcSend('notch-bubble:resize', width, height);
  },
  getWindowPosition: () => {
    return ipcRenderer.invoke('notch-bubble:get-position');
  },
  getNotchPosition: () => {
    return ipcRenderer.invoke('notch-bubble:get-notch-position');
  },
  setPinned: (pinned) => {
    safeIpcSend('notch-bubble:set-pinned', pinned);
  },
});
