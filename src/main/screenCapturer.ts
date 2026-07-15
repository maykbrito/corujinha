// src/main/screenCapturer.ts
import { BrowserWindow, app } from "electron";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";

export class ScreenCapturer {
  private pending = new Map<string, (r: { ok: boolean; dataUrl?: string; error?: string }) => void>();
  constructor(private worker: BrowserWindow) {}

  // Called by the IPC handler for "capture:result".
  resolve(requestId: string, result: { ok: boolean; dataUrl?: string; error?: string }) {
    this.pending.get(requestId)?.(result);
    this.pending.delete(requestId);
  }

  capture(): Promise<{ dataUrl: string; thumbPath: string }> {
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error("capture timeout")); }, 5000);
      this.pending.set(id, (r) => {
        clearTimeout(timer);
        if (!r.ok || !r.dataUrl) return reject(new Error(r.error ?? "capture failed"));
        const dir = join(app.getPath("userData"), "captures");
        mkdirSync(dir, { recursive: true });
        const thumbPath = join(dir, `${id}.webp`);
        writeFileSync(thumbPath, Buffer.from(r.dataUrl.split(",")[1], "base64"));
        resolve({ dataUrl: r.dataUrl, thumbPath });
      });
      this.worker.webContents.send("capture:do", id);
    });
  }
}
