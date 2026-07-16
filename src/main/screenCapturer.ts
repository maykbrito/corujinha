// src/main/screenCapturer.ts
import { BrowserWindow, app } from "electron";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";

export class ScreenCapturer {
  private pending = new Map<string, (r: { ok: boolean; dataUrl?: string; error?: string }) => void>();
  // The worker renderer registers its "capture:do" listener only after its module loads.
  // Sending before then silently drops the first request, so gate every send on this promise.
  private ready: Promise<void>;

  constructor(private worker: BrowserWindow) {
    this.ready = worker.webContents.isLoading()
      ? new Promise<void>((res) => worker.webContents.once("did-finish-load", () => res()))
      : Promise.resolve();
  }

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
        const thumbPath = join(dir, `${id}.jpg`);
        writeFileSync(thumbPath, Buffer.from(r.dataUrl.split(",")[1], "base64"));
        resolve({ dataUrl: r.dataUrl, thumbPath });
      });
      // Wait for the worker to have loaded so its "capture:do" listener exists.
      this.ready.then(() => this.worker.webContents.send("capture:do", id));
    });
  }
}
