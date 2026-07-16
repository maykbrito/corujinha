const { BrowserWindow, screen, ipcMain } = require('electron');
const path = require('path');
const log = require('electron-log');
const { getStealthModeState } = require('./ipc/window-management');
const { normalizeOverlayShapeRects } = require('./ipc/window-management/overlayMouseControl');
const {
  fitBoundsToDisplay,
  getResolutionAwareZoomFactor,
  normalizeWindowZoom,
} = require('./displayLayout');
const {
  registerDisplayTopologyWindow,
  unregisterDisplayTopologyWindow,
} = require('./displayTopologyCoordinator');
const { getAppWindowOpacity } = require('./appWindowOpacityController');
const { getFlavorBrandForRenderer } = require('./flavorBrand');
const { isFlavorFeatureEnabled } = require('./flavorConfig');

let notchWindow = null;
let fadeTimer = null;
let hideTimeout = null;
let isPinned = true; // true = pinned to notch position, false = floating
let lastNotchSettings = null;
const DEFAULT_WINDOW_WIDTH = 450;
const DEFAULT_WINDOW_HEIGHT = 320;
const WINDOW_PADDING_X = 14;
const WINDOW_PADDING_Y = 16;
const MIN_EXPANDED_WIDTH = 360;
const MAX_EXPANDED_WIDTH = 900;
const MIN_EXPANDED_HEIGHT = 160;
const MAX_EXPANDED_HEIGHT = 640;
let notchWindowSize = { width: DEFAULT_WINDOW_WIDTH, height: DEFAULT_WINDOW_HEIGHT };

function canUseNativeShape(win) {
  return process.platform === 'win32' && win && typeof win.setShape === 'function';
}

function getNotchShapeScale(win) {
  try {
    const zoomFactor = win?.webContents?.getZoomFactor?.();
    if (Number.isFinite(zoomFactor) && zoomFactor > 0) {
      return zoomFactor;
    }
  } catch (_) {
    // Fall through to display-derived zoom.
  }

  const fallbackZoomFactor = getNotchZoomFactor();
  return Number.isFinite(fallbackZoomFactor) && fallbackZoomFactor > 0
    ? fallbackZoomFactor
    : 1;
}

function getNotchShapeBounds(win) {
  try {
    if (win && !win.isDestroyed()) {
      return win.getBounds();
    }
  } catch (_) {
    // Fall through to the cached window size.
  }

  return {
    x: 0,
    y: 0,
    width: notchWindowSize.width,
    height: notchWindowSize.height,
  };
}

function scaleNotchShapeRects(rects, win) {
  const scale = getNotchShapeScale(win);
  if (scale === 1) return rects;

  return rects.map((rect) => ({
    x: Number(rect?.x) * scale,
    y: Number(rect?.y) * scale,
    width: Number(rect?.width) * scale,
    height: Number(rect?.height) * scale,
  }));
}

function getCollapsedNotchShape(win) {
  const scale = getNotchShapeScale(win);
  const bounds = getNotchShapeBounds(win);
  const width = 300 * scale;
  const height = 34 * scale;
  return [{
    x: Math.max(0, Math.round((bounds.width - width) / 2)),
    y: 0,
    width,
    height,
  }];
}

function getCollapsedNotchScreenRect(win) {
  const bounds = getNotchShapeBounds(win);
  const width = Math.min(300, bounds.width);
  return {
    x: bounds.x + Math.max(0, Math.round((bounds.width - width) / 2)),
    y: bounds.y,
    width,
    height: Math.min(34, bounds.height),
  };
}

function setInitialWindowsNotchShape(win) {
  if (!canUseNativeShape(win)) return;

  try {
    const bounds = getNotchShapeBounds(win);
    win.setShape(normalizeOverlayShapeRects(getCollapsedNotchShape(win), bounds));
  } catch (error) {
    log.warn('[NotchBubble] Failed to set initial Windows shape:', error);
  }
}

function setNotchIgnoreMouseEvents(ignore, options) {
  if (!notchWindow || notchWindow.isDestroyed()) return;

  // Windows uses native window shape for pass-through. Avoid Electron's
  // forwarded mouse hook here; it can stop delivering hover events on
  // non-activating transparent windows.
  if (canUseNativeShape(notchWindow)) {
    if (!ignore) {
      notchWindow.setIgnoreMouseEvents(false);
    }
    return;
  }

  notchWindow.setIgnoreMouseEvents(ignore, options || {});
}

function isPointInRect(point, rect) {
  return point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height;
}

function syncNotchMouseEventsWithCursor() {
  if (!notchWindow || notchWindow.isDestroyed() || canUseNativeShape(notchWindow)) return;

  try {
    const cursorPoint = screen.getCursorScreenPoint();
    const collapsedRect = getCollapsedNotchScreenRect(notchWindow);
    setNotchIgnoreMouseEvents(!isPointInRect(cursorPoint, collapsedRect), { forward: true });
  } catch (error) {
    log.warn('[NotchBubble] Failed to sync click-through with cursor:', error);
  }
}

function scheduleNotchMouseEventsSync(delayMs = 0) {
  setTimeout(syncNotchMouseEventsWithCursor, delayMs);
}

function clamp(value, min, max) {
  const safeMin = Math.min(min, max);
  const safeMax = Math.max(min, max);
  return Math.min(Math.max(value, safeMin), safeMax);
}

function getNotchDisplay() {
  return screen.getPrimaryDisplay();
}

function getNotchZoomFactor() {
  return getResolutionAwareZoomFactor(getNotchDisplay());
}

function scaleNotchDimension(value) {
  return Math.round(value * getNotchZoomFactor());
}

function getDefaultWindowSize() {
  return {
    width: scaleNotchDimension(DEFAULT_WINDOW_WIDTH),
    height: scaleNotchDimension(DEFAULT_WINDOW_HEIGHT),
  };
}

function getWindowSizeForExpandedSize(expandedWidth, expandedHeight) {
  const zoomFactor = getNotchZoomFactor();
  return {
    width: clamp(
      Math.round((expandedWidth + WINDOW_PADDING_X) * zoomFactor),
      Math.round((MIN_EXPANDED_WIDTH + WINDOW_PADDING_X) * zoomFactor),
      Math.round((MAX_EXPANDED_WIDTH + WINDOW_PADDING_X) * zoomFactor)
    ),
    height: clamp(
      Math.round((expandedHeight + WINDOW_PADDING_Y) * zoomFactor),
      Math.round((MIN_EXPANDED_HEIGHT + WINDOW_PADDING_Y) * zoomFactor),
      Math.round((MAX_EXPANDED_HEIGHT + WINDOW_PADDING_Y) * zoomFactor)
    ),
  };
}

function clearFadeAnimation() {
  if (fadeTimer) {
    clearInterval(fadeTimer);
    fadeTimer = null;
  }
}

function fadeIn(win, duration) {
  clearFadeAnimation();
  if (!win || win.isDestroyed()) return;
  duration = duration || 250;
  const steps = 15;
  const stepMs = duration / steps;
  let step = 0;
  win.setOpacity(0);
  win.show();
  fadeTimer = setInterval(() => {
    step++;
    if (step >= steps || win.isDestroyed()) {
      clearInterval(fadeTimer);
      fadeTimer = null;
      if (!win.isDestroyed()) win.setOpacity(getAppWindowOpacity());
    } else {
      // Ease-out quadratic: appears quickly, settles in
      const t = step / steps;
      if (!win.isDestroyed()) win.setOpacity(getAppWindowOpacity() * t * (2 - t));
    }
  }, stepMs);
}

function fadeOut(win, duration) {
  clearFadeAnimation();
  if (!win || win.isDestroyed()) return;
  duration = duration || 200;
  const steps = 12;
  const stepMs = duration / steps;
  const startOpacity = win.getOpacity();
  let step = 0;
  fadeTimer = setInterval(() => {
    step++;
    if (step >= steps || win.isDestroyed()) {
      clearInterval(fadeTimer);
      fadeTimer = null;
      if (!win.isDestroyed()) {
        win.setOpacity(0);
        win.hide();
      }
    } else {
      // Ease-in quadratic: fades slowly then vanishes
      const t = step / steps;
      if (!win.isDestroyed()) win.setOpacity(startOpacity * (1 - t * t));
    }
  }, stepMs);
}

function getNotchBounds() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { bounds } = primaryDisplay;
  // Center horizontally, positioned at absolute top of screen (behind menu bar / notch)
  const width = notchWindowSize.width;
  const height = notchWindowSize.height;
  const yOffset = process.platform === 'linux' ? 8 : 0;
  return {
    x: bounds.x + Math.round((bounds.width - width) / 2),
    y: bounds.y + yOffset,
    width,
    height,
  };
}

function createNotchWindow() {
  if (notchWindow && !notchWindow.isDestroyed()) {
    fadeIn(notchWindow);
    return notchWindow;
  }

  if (notchWindowSize.width === DEFAULT_WINDOW_WIDTH && notchWindowSize.height === DEFAULT_WINDOW_HEIGHT) {
    notchWindowSize = getDefaultWindowSize();
  }

  const { x, y, width, height } = getNotchBounds();

  notchWindow = new BrowserWindow({
    x,
    y,
    width,
    height,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    movable: false,
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    roundedCorners: false,
    fullscreenable: false,
    minimizable: false,
    maximizable: false,
    show: false,
    type: process.platform === 'darwin' ? 'panel' : undefined,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'notchBubblePreload.js'),
    },
  });

  normalizeWindowZoom(notchWindow);
  registerDisplayTopologyWindow({
    id: 'notch-bubble',
    getDisplayId: () => getNotchDisplay().id,
    getWindow: () => notchWindow,
    getTargetBounds: (display, oldBounds) => (
      isPinned ? getNotchBounds() : fitBoundsToDisplay(oldBounds, display, {
        edgePadding: 12,
        minHeight: 34,
        minVisibleArea: 34 * 120,
        minVisibleRatio: 0.2,
        minWidth: 120,
      })
    ),
  });

  // Platform-specific alwaysOnTop and workspace visibility
  if (process.platform === 'darwin') {
    // Level 'screen-saver' ensures it appears above the menu bar / notch area
    notchWindow.setAlwaysOnTop(true, 'screen-saver');
    // Allow it to be visible on all macOS workspaces
    notchWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  } else {
    notchWindow.setAlwaysOnTop(true, 'pop-up-menu');
  }
  // Windows uses native shape for pass-through; other platforms use
  // click-through forwarding until content opts in.
  if (canUseNativeShape(notchWindow)) {
    notchWindow.setIgnoreMouseEvents(false);
    setInitialWindowsNotchShape(notchWindow);
  } else {
    notchWindow.setIgnoreMouseEvents(true, { forward: true });
  }

  const htmlPath = path.join(__dirname, 'notch-bubble.html');
  notchWindow.loadFile(htmlPath);
  notchWindow.webContents.once('did-finish-load', () => {
    sendCachedNotchSettings();
    forwardToMainRenderer('notch-bubble:settings-requested');
  });

  // Apply stealth mode content protection if enabled
  if (getStealthModeState()) {
    notchWindow.setContentProtection(true);
  }

  notchWindow.once('ready-to-show', () => {
    fadeIn(notchWindow);
    scheduleNotchMouseEventsSync(50);
  });

  notchWindow.on('closed', () => {
    unregisterDisplayTopologyWindow('notch-bubble');
    notchWindow = null;
  });

  log.info('[NotchBubble] Window created');
  return notchWindow;
}

function resetNotchBubble() {
  if (notchWindow && !notchWindow.isDestroyed()) {
    notchWindow.webContents.send('notch-bubble:reset');
    scheduleNotchMouseEventsSync(50);
  }
}

function showNotchBubble() {
  clearTimeout(hideTimeout);
  hideTimeout = null;
  if (!notchWindow || notchWindow.isDestroyed()) {
    isPinned = true;
    createNotchWindow();
  } else {
    const wasVisible = notchWindow.isVisible();
    // Only reposition if pinned to notch (not floating)
    if (isPinned) {
      const { x, y, width, height } = getNotchBounds();
      notchWindow.setBounds({ x, y, width, height });
    }
    fadeIn(notchWindow);
    if (!wasVisible) scheduleNotchMouseEventsSync(50);
  }
}

function hideNotchBubble() {
  if (!notchWindow || notchWindow.isDestroyed()) return;
  // Collapse the panel (same animation as Skip), then fade out the pill
  collapseNotchBubble();
  clearTimeout(hideTimeout);
  hideTimeout = setTimeout(() => {
    hideTimeout = null;
    fadeOut(notchWindow);
  }, 400);
}

function collapseNotchBubble() {
  if (notchWindow && !notchWindow.isDestroyed()) {
    notchWindow.webContents.send('notch-bubble:collapse');
  }
}

function updateNotchBubble(data) {
  if (notchWindow && !notchWindow.isDestroyed()) {
    notchWindow.webContents.send('notch-bubble:update', data);
  }
}

function updateNotchSettings(data) {
  lastNotchSettings = {
    ...(lastNotchSettings || {}),
    ...(data || {}),
    labels: {
      ...((lastNotchSettings && lastNotchSettings.labels) || {}),
      ...((data && data.labels) || {}),
    },
  };
  if (notchWindow && !notchWindow.isDestroyed()) {
    notchWindow.webContents.send('notch-bubble:update-settings', data);
  }
}

function sendCachedNotchSettings() {
  if (lastNotchSettings && notchWindow && !notchWindow.isDestroyed()) {
    notchWindow.webContents.send('notch-bubble:update-settings', lastNotchSettings);
  }
}

function forwardToMainRenderer(channel, ...args) {
  const { BrowserWindow: BW } = require('electron');
  const allWindows = BW.getAllWindows();
  for (const win of allWindows) {
    if (win !== notchWindow && !win.isDestroyed()) {
      win.webContents.send(channel, ...args);
    }
  }
}

function scrollNotchBubble(direction) {
  if (notchWindow && !notchWindow.isDestroyed()) {
    notchWindow.webContents.send('notch-bubble:scroll', direction);
  }
}

function navigateNotchHistory(direction) {
  if (notchWindow && !notchWindow.isDestroyed()) {
    notchWindow.webContents.send('notch-bubble:navigate-history', direction);
  }
}

function destroyNotchBubble() {
  clearTimeout(hideTimeout);
  hideTimeout = null;
  clearFadeAnimation();
  if (notchWindow && !notchWindow.isDestroyed()) {
    notchWindow.close();
    unregisterDisplayTopologyWindow('notch-bubble');
    notchWindow = null;
  }
}

function reinforceWindowsNotchAlwaysOnTop() {
  if (
    process.platform !== 'win32' ||
    !notchWindow ||
    notchWindow.isDestroyed() ||
    canUseNativeShape(notchWindow)
  ) {
    return;
  }

  setTimeout(() => {
    if (notchWindow && !notchWindow.isDestroyed()) {
      notchWindow.setAlwaysOnTop(true, 'pop-up-menu');
    }
  }, 10);
}

function handleNotchSetIgnoreMouse(_event, ignore, options) {
  if (!notchWindow || notchWindow.isDestroyed()) return;

  setNotchIgnoreMouseEvents(ignore, options);
  if (ignore) {
    reinforceWindowsNotchAlwaysOnTop();
  }
}

function handleNotchSetShape(_event, rects) {
  if (!canUseNativeShape(notchWindow)) return;

  try {
    const bounds = getNotchShapeBounds(notchWindow);
    const shapeRects = Array.isArray(rects)
      ? scaleNotchShapeRects(rects, notchWindow)
      : getCollapsedNotchShape(notchWindow);
    const nextRects = normalizeOverlayShapeRects(shapeRects, bounds);
    notchWindow.setShape(
      nextRects.length > 0
        ? nextRects
        : [{ x: 0, y: 0, width: 1, height: 1 }]
    );
    notchWindow.setIgnoreMouseEvents(false);
  } catch (error) {
    log.warn('[NotchBubble] Failed to set Windows shape:', error);
  }
}

function handleNotchGetBrand() {
  try {
    return getFlavorBrandForRenderer();
  } catch (error) {
    log.warn('[NotchBubble] Failed to resolve flavor brand:', error);
    return null;
  }
}

function handleNotchGetFlavorFeatures() {
  return {
    fastFirstInsight: isFlavorFeatureEnabled('fastFirstInsight'),
  };
}

// IPC handlers
function registerNotchBubbleHandlers() {
  ipcMain.on('notch-bubble:show', () => {
    showNotchBubble();
  });

  ipcMain.on('notch-bubble:hide', () => {
    hideNotchBubble();
  });

  ipcMain.on('notch-bubble:update', (_event, data) => {
    updateNotchBubble(data);
  });

  ipcMain.on('notch-bubble:destroy', () => {
    destroyNotchBubble();
  });

  ipcMain.on('notch-bubble:reset', () => {
    resetNotchBubble();
  });

  ipcMain.on('notch-bubble:set-ignore-mouse', handleNotchSetIgnoreMouse);
  ipcMain.on('notch-bubble:set-shape', handleNotchSetShape);
  ipcMain.handle('notch-bubble:get-brand', handleNotchGetBrand);
  ipcMain.handle('notch-bubble:get-flavor-features', handleNotchGetFlavorFeatures);

  // Handle collapse request from renderer
  ipcMain.on('notch-bubble:collapse', () => {
    collapseNotchBubble();
  });

  // Forward skip notification from notch bubble to main renderer
  ipcMain.on('notch-bubble:skipped', () => {
    forwardToMainRenderer('notch-bubble:skipped');
  });

  ipcMain.on('notch-bubble:follow-up-options-requested', (_event, payload) => {
    forwardToMainRenderer('notch-bubble:follow-up-options-requested', payload);
  });

  ipcMain.on('notch-bubble:follow-up-clicked', (_event, payload) => {
    forwardToMainRenderer('notch-bubble:follow-up-clicked', payload);
  });

  ipcMain.on('notch-bubble:error-action', (_event, payload) => {
    forwardToMainRenderer('notch-bubble:error-action', payload);
  });

  // Forward sensitivity change from notch bubble to main renderer
  ipcMain.on('notch-bubble:sensitivity-change', (_event, value) => {
    forwardToMainRenderer('notch-bubble:sensitivity-change', value);
  });

  // Forward capture-selection setting changes from notch bubble to main renderer
  ipcMain.on('notch-bubble:capture-selection-change', (_event, enabled) => {
    forwardToMainRenderer('notch-bubble:capture-selection-change', !!enabled);
  });

  // Forward mode changes from notch bubble settings to main renderer
  ipcMain.on('notch-bubble:mode-change', (_event, mode) => {
    forwardToMainRenderer('notch-bubble:mode-change', mode);
  });

  // Forward response language changes from notch bubble settings to main renderer
  ipcMain.on('notch-bubble:response-language-change', (_event, value) => {
    forwardToMainRenderer('notch-bubble:response-language-change', value);
  });

  // Forward settings update from main renderer to notch bubble
  ipcMain.on('notch-bubble:send-settings', (_event, data) => {
    updateNotchSettings(data);
  });

  ipcMain.on('notch-bubble:request-settings', () => {
    sendCachedNotchSettings();
    forwardToMainRenderer('notch-bubble:settings-requested');
  });

  ipcMain.on('notch-bubble:scroll', (_event, direction) => {
    scrollNotchBubble(direction);
  });

  ipcMain.on('notch-bubble:navigate-history', (_event, direction) => {
    navigateNotchHistory(direction);
  });

  // Drag support: move window to position
  ipcMain.on('notch-bubble:move', (_event, x, y) => {
    if (notchWindow && !notchWindow.isDestroyed() && Number.isFinite(x) && Number.isFinite(y)) {
      notchWindow.setPosition(Math.round(x), Math.round(y));
    }
  });

  ipcMain.on('notch-bubble:resize', (_event, expandedWidth, expandedHeight) => {
    if (!notchWindow || notchWindow.isDestroyed()) return;
    if (!Number.isFinite(expandedWidth) || !Number.isFinite(expandedHeight)) return;

    const currentBounds = notchWindow.getBounds();
    const nextSize = getWindowSizeForExpandedSize(expandedWidth, expandedHeight);
    notchWindowSize = nextSize;
    const nextBounds = isPinned
      ? getNotchBounds()
      : {
          x: currentBounds.x,
          y: currentBounds.y,
          width: nextSize.width,
          height: nextSize.height,
        };
    notchWindow.setBounds(nextBounds);
  });

  // Drag support: get current window position
  ipcMain.handle('notch-bubble:get-position', () => {
    if (notchWindow && !notchWindow.isDestroyed()) {
      const pos = notchWindow.getPosition();
      return { x: pos[0], y: pos[1] };
    }
    return null;
  });

  // Drag support: get the default notch position (snap target)
  ipcMain.handle('notch-bubble:get-notch-position', () => {
    const bounds = getNotchBounds();
    return { x: bounds.x, y: bounds.y };
  });

  // Drag support: set pinned state
  ipcMain.on('notch-bubble:set-pinned', (_event, pinned) => {
    isPinned = !!pinned;
  });
}

function unregisterNotchBubbleHandlers() {
  ipcMain.removeAllListeners('notch-bubble:show');
  ipcMain.removeAllListeners('notch-bubble:hide');
  ipcMain.removeAllListeners('notch-bubble:update');
  ipcMain.removeAllListeners('notch-bubble:destroy');
  ipcMain.removeAllListeners('notch-bubble:set-ignore-mouse');
  ipcMain.removeAllListeners('notch-bubble:set-shape');
  ipcMain.removeHandler('notch-bubble:get-brand');
  ipcMain.removeHandler('notch-bubble:get-flavor-features');
  ipcMain.removeAllListeners('notch-bubble:collapse');
  ipcMain.removeAllListeners('notch-bubble:skipped');
  ipcMain.removeAllListeners('notch-bubble:follow-up-options-requested');
  ipcMain.removeAllListeners('notch-bubble:follow-up-clicked');
  ipcMain.removeAllListeners('notch-bubble:error-action');
  ipcMain.removeAllListeners('notch-bubble:sensitivity-change');
  ipcMain.removeAllListeners('notch-bubble:capture-selection-change');
  ipcMain.removeAllListeners('notch-bubble:mode-change');
  ipcMain.removeAllListeners('notch-bubble:response-language-change');
  ipcMain.removeAllListeners('notch-bubble:send-settings');
  ipcMain.removeAllListeners('notch-bubble:request-settings');
  ipcMain.removeAllListeners('notch-bubble:scroll');
  ipcMain.removeAllListeners('notch-bubble:navigate-history');
  ipcMain.removeAllListeners('notch-bubble:reset');
  ipcMain.removeAllListeners('notch-bubble:move');
  ipcMain.removeAllListeners('notch-bubble:resize');
  ipcMain.removeAllListeners('notch-bubble:set-pinned');
  ipcMain.removeHandler('notch-bubble:get-position');
  ipcMain.removeHandler('notch-bubble:get-notch-position');
}

function getNotchWindow() {
  return notchWindow;
}

module.exports = {
  getNotchWindow,
  createNotchWindow,
  showNotchBubble,
  hideNotchBubble,
  collapseNotchBubble,
  updateNotchBubble,
  updateNotchSettings,
  scrollNotchBubble,
  destroyNotchBubble,
  registerNotchBubbleHandlers,
  unregisterNotchBubbleHandlers,
};
