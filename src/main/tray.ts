// src/main/tray.ts
import { Tray, Menu, nativeImage, app } from "electron";
import { join } from "path";

function trayIcon() {
  const dev = !!process.env["ELECTRON_RENDERER_URL"];
  const path = dev ? join(app.getAppPath(), "resources/trayTemplate.png")
                   : join(process.resourcesPath, "trayTemplate.png");
  const img = nativeImage.createFromPath(path);
  img.setTemplateImage(true);
  return img;
}

export function createTray(handlers: { openDashboard: () => void; openSettings: () => void }): Tray {
  const tray = new Tray(trayIcon());
  tray.setToolTip("See-and-Talk");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Dashboard", click: handlers.openDashboard },
    { label: "Settings", click: handlers.openSettings },
    { type: "separator" },
    { label: "Quit", click: () => app.quit() },
  ]));
  return tray;
}
