// src/shared/ipcChannels.ts
export const IPC = {
  // history
  HISTORY_START_SESSION: "history:startSession",
  HISTORY_END_SESSION: "history:endSession",
  HISTORY_ADD_TURN: "history:addTurn",
  HISTORY_ADD_CAPTURE: "history:addCapture",
  HISTORY_SET_CAPTURE_SUMMARY: "history:setCaptureSummary",
  HISTORY_LIST_SESSIONS: "history:listSessions",
  HISTORY_LIST_TURNS: "history:listTurns",
  HISTORY_LIST_CAPTURES: "history:listCaptures",
  HISTORY_SEARCH: "history:search",
  // auth/config
  KEY_GET_STATUS: "key:status",
  KEY_SET: "key:set",
  TOKEN_MINT: "token:mint",
  // capture
  CAPTURE_SCREEN: "capture:screen",
  CAPTURE_THUMB: "capture:thumb", // read a stored thumbnail file -> data URL (dashboard)
  // notch window control
  NOTCH_SET_FOCUSABLE: "notch:setFocusable",
  // permissions
  PERM_STATUS: "perm:status",
  PERM_REQUEST: "perm:request",
  PERM_OPEN_SCREEN_SETTINGS: "perm:openScreenSettings",
} as const;

// Main -> renderer broadcast events (not invoke handlers).
export const IPC_EVENT = {
  KEY_CHANGED: "key:changed", // notch re-checks key status to enable/disable Start
  HOTKEY_ASK_NOW: "hotkey:askNow",
  HOTKEY_TOGGLE_MUTE: "hotkey:toggleMute",
} as const;
