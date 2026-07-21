export type { ConfigData, ShortcutMap } from "@shared/types";
import type { ConfigData } from "@shared/types";
export const DEFAULT_CONFIG: ConfigData = {
  ollamaUrl: "http://localhost:11434",
  model: "gemma4:26b",
  hideFromCapture: true,
  opacity: 1,
  sendScreen: true,
  shortcuts: {
    scrollUp: "CommandOrControl+Shift+Up",
    scrollDown: "CommandOrControl+Shift+Down",
    prevPage: "CommandOrControl+Shift+Left",
    nextPage: "CommandOrControl+Shift+Right",
    captureRegion: "CommandOrControl+Shift+2",
  },
};

export interface ConfigDisk { read(): string | null; write(s: string): void; }

export class ConfigStore {
  constructor(private disk: ConfigDisk) {}
  get(): ConfigData {
    const raw = this.disk.read();
    if (!raw) return { ...DEFAULT_CONFIG };
    try {
      const parsed = JSON.parse(raw) as Partial<ConfigData>;
      // Deep-merge `shortcuts` so a legacy file missing a newer key (e.g. captureRegion)
      // still gets the default for it, instead of the whole sub-object replacing the default.
      return {
        ...DEFAULT_CONFIG,
        ...parsed,
        shortcuts: { ...DEFAULT_CONFIG.shortcuts, ...parsed.shortcuts },
      };
    } catch {
      return { ...DEFAULT_CONFIG };
    }
  }
  set(partial: Partial<ConfigData>): ConfigData {
    const next = { ...this.get(), ...partial };
    this.disk.write(JSON.stringify(next));
    return next;
  }
}

import { app } from "electron";
import { writeFileSync, readFileSync, existsSync } from "fs";
import { join } from "path";

export function makeElectronConfigStore(): ConfigStore {
  const file = join(app.getPath("userData"), "config.json");
  return new ConfigStore({
    read: () => (existsSync(file) ? readFileSync(file, "utf8") : null),
    write: (s) => writeFileSync(file, s),
  });
}
