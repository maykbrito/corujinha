const MIN_APP_WINDOW_OPACITY = 0.25;
const MAX_APP_WINDOW_OPACITY = 1;
const APP_WINDOW_OPACITY_STEP = 0.1;

let appWindowOpacity = MAX_APP_WINDOW_OPACITY;
let getOverlayWindow = () => null;
let getMainAppWindow = () => null;
let getNotchWindow = () => null;
let logger = console;

function clampOpacity(value) {
  const clamped = Math.min(MAX_APP_WINDOW_OPACITY, Math.max(MIN_APP_WINDOW_OPACITY, value));
  return Math.round(clamped * 100) / 100;
}

function isUsableWindow(window) {
  return window && !window.isDestroyed();
}

function getManagedWindows() {
  const windows = [
    getOverlayWindow(),
    getMainAppWindow(),
    getNotchWindow(),
  ];
  const seenIds = new Set();

  return windows.filter((window) => {
    if (!isUsableWindow(window) || seenIds.has(window.id)) {
      return false;
    }

    seenIds.add(window.id);
    return true;
  });
}

function initAppWindowOpacityController(options = {}) {
  getOverlayWindow = typeof options.getOverlayWindow === 'function'
    ? options.getOverlayWindow
    : getOverlayWindow;
  getMainAppWindow = typeof options.getMainAppWindow === 'function'
    ? options.getMainAppWindow
    : getMainAppWindow;
  getNotchWindow = typeof options.getNotchWindow === 'function'
    ? options.getNotchWindow
    : getNotchWindow;
  logger = options.log || logger;
}

function getAppWindowOpacity() {
  return appWindowOpacity;
}

function applyAppWindowOpacityToWindow(window, options = {}) {
  if (!isUsableWindow(window)) {
    return false;
  }

  if (!options.force && (!window.isVisible() || window.getOpacity() === 0)) {
    return false;
  }

  try {
    window.setOpacity(appWindowOpacity);
    return true;
  } catch (error) {
    logger?.warn?.(`[AppWindowOpacity] Failed to apply opacity: ${error.message}`);
    return false;
  }
}

function applyAppWindowOpacity(options = {}) {
  let appliedCount = 0;
  for (const window of getManagedWindows()) {
    if (applyAppWindowOpacityToWindow(window, options)) {
      appliedCount += 1;
    }
  }
  return appliedCount;
}

function adjustAppWindowOpacity(direction) {
  const delta = direction > 0 ? APP_WINDOW_OPACITY_STEP : -APP_WINDOW_OPACITY_STEP;
  appWindowOpacity = clampOpacity(appWindowOpacity + delta);
  const appliedCount = applyAppWindowOpacity();
  logger?.info?.(
    `[AppWindowOpacity] Set app window opacity to ${Math.round(appWindowOpacity * 100)}% (${appliedCount} windows)`
  );
  return appWindowOpacity;
}

module.exports = {
  adjustAppWindowOpacity,
  applyAppWindowOpacity,
  applyAppWindowOpacityToWindow,
  getAppWindowOpacity,
  initAppWindowOpacityController,
};
