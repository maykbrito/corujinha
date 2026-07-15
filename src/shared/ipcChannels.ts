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
  HISTORY_SEARCH: "history:search",
  // auth/config
  KEY_GET_STATUS: "key:status",
  KEY_SET: "key:set",
  TOKEN_MINT: "token:mint",
  // capture
  CAPTURE_SCREEN: "capture:screen",
  // notch window control
  NOTCH_SET_FOCUSABLE: "notch:setFocusable",
  // permissions
  PERM_STATUS: "perm:status",
  PERM_REQUEST: "perm:request",
} as const;
