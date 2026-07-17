export interface ShortcutMap { scrollUp: string; scrollDown: string; prevPage: string; nextPage: string; }
export interface ConfigData { ollamaUrl: string; model: string; hideFromCapture: boolean; opacity: number; shortcuts: ShortcutMap; }
export const DEFAULT_CONFIG: ConfigData = {
  ollamaUrl: "http://localhost:11434",
  model: "gemma4:26b",
  hideFromCapture: true,
  opacity: 1,
  shortcuts: {
    scrollUp: "CommandOrControl+Shift+Up",
    scrollDown: "CommandOrControl+Shift+Down",
    prevPage: "CommandOrControl+Shift+Left",
    nextPage: "CommandOrControl+Shift+Right",
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
      return { ...DEFAULT_CONFIG, ...parsed };
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
