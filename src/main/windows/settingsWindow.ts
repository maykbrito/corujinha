// src/main/windows/settingsWindow.ts
import { makeSingletonWindow } from "./singletonWindow";

// The Settings window is the only "real" window authorized to quit the app,
// so main also needs to identify it — hence the exported getter.
const settings = makeSingletonWindow({ width: 520, height: 560, title: "Corujinha — Settings", route: "settings" });
export const openSettingsWindow = settings.open;
export const getSettingsWindow = settings.get;
