// src/shared/ipcChannels.ts
export const IPC = {
  // history
  HISTORY_START_SESSION: "history:startSession",
  HISTORY_END_SESSION: "history:endSession",
  HISTORY_ADD_TURN: "history:addTurn",
  HISTORY_ADD_CAPTURE: "history:addCapture",
  HISTORY_LIST_SESSIONS: "history:listSessions",
  HISTORY_LIST_TURNS: "history:listTurns",
  HISTORY_LIST_CAPTURES: "history:listCaptures",
  HISTORY_SEARCH: "history:search",
  HISTORY_REOPEN_SESSION: "history:reopenSession",
  // session management
  SESSION_CONTINUE: "session:continue",
  // config + brain
  CONFIG_GET: "config:get",
  CONFIG_SET: "config:set",
  OLLAMA_CHAT: "ollama:chat",
  // capture
  CAPTURE_SCREEN: "capture:screen",
  CAPTURE_THUMB: "capture:thumb", // read a stored thumbnail file -> data URL (dashboard)
  CAPTURE_OPEN: "capture:open", // open a stored screenshot in the default viewer
  CAPTURE_REVEAL: "capture:reveal", // reveal a stored screenshot in Finder
  // notch window control (Cody-style morph/drag/resize)
  NOTCH_SET_FOCUSABLE: "notch:setFocusable",
  NOTCH_MOVE: "notch:move",
  NOTCH_RESIZE: "notch:resize",
  NOTCH_GET_POSITION: "notch:getPosition",
  NOTCH_GET_NOTCH_POSITION: "notch:getNotchPosition",
  NOTCH_SET_PINNED: "notch:setPinned",
  NOTCH_SET_IGNORE_MOUSE: "notch:setIgnoreMouse",
  // permissions
  PERM_STATUS: "perm:status",
  PERM_OPEN_SCREEN_SETTINGS: "perm:openScreenSettings",
} as const;

// Main -> renderer broadcast events (not invoke handlers).
export const IPC_EVENT = {
  HOTKEY_ASK_NOW: "hotkey:askNow",
  NOTCH_CONTINUE_SESSION: "notch:continueSession", // main -> notch: load + resume a session from history
  NOTCH_SET_OPACITY: "notch:setOpacity", // main -> notch: apply an opacity changed from Settings
} as const;
