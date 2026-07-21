// src/renderer/captureWorker/main.ts
import { toPixelCrop, type Rect } from "@shared/cropRect";
const api = (window as any).api;

interface CropReq { rect: Rect; disp: { scaleFactor: number; pointW: number; pointH: number }; }

// maxWidth 1920 + quality 0.92: crisp enough for the model to read on-screen numbers/code.
// JPEG (not WebP): Ollama/llama.cpp decodes images via stb_image, which supports JPEG/PNG but
// NOT WebP — a WebP payload fails with "Failed to load image or audio file". JPEG @0.92 keeps
// text readable and is far smaller than PNG.
// A `crop` skips the 1920 downscale and encodes the selected region at native resolution @0.95,
// so small text keeps as many of the model's fixed 896px as possible.
// ponytail: JPEG; if small colored text ever reads poorly, switch to "image/png" (lossless, larger).
async function captureOnce(crop?: CropReq, maxWidth = 1920, quality = 0.92): Promise<string> {
  // Ask for the display's native resolution (up to 4K) — the default is capped low, which
  // is why small text was unreadable.
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { width: { ideal: 3840 }, height: { ideal: 2160 }, frameRate: 1 },
    audio: false,
  });
  try {
    const video = document.createElement("video");
    video.srcObject = stream;
    await video.play();
    // Wait for real dimensions before reading videoWidth/videoHeight — reading right
    // after play() can yield 0 on the first frame, producing a 0x0 canvas. Poll via
    // requestAnimationFrame so we can't miss a one-shot event (race-free).
    await waitForDimensions(video);
    const vw = video.videoWidth, vh = video.videoHeight;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingQuality = "high";
    if (crop) {
      const px = toPixelCrop(crop.rect, crop.disp, { frameW: vw, frameH: vh });
      canvas.width = px.w;
      canvas.height = px.h;
      ctx.drawImage(video, px.x, px.y, px.w, px.h, 0, 0, px.w, px.h);
      return canvas.toDataURL("image/jpeg", 0.95); // small region → higher quality
    }
    const scale = Math.min(1, maxWidth / vw); // never upscale
    canvas.width = Math.round(vw * scale);
    canvas.height = Math.round(vh * scale);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", quality);
  } finally {
    // Always release the live screen-capture stream, even if drawing/encoding throws.
    stream.getTracks().forEach((t) => t.stop());
  }
}

function waitForDimensions(video: HTMLVideoElement, timeoutMs = 4000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      if (video.videoWidth && video.videoHeight) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error("video dimensions never became available"));
      requestAnimationFrame(tick);
    };
    tick();
  });
}

api.on("capture:do", async (requestId: string, crop?: CropReq) => {
  try {
    const dataUrl = await captureOnce(crop);
    api.invoke("capture:result", requestId, { ok: true, dataUrl });
  } catch (e) {
    api.invoke("capture:result", requestId, { ok: false, error: String(e) });
  }
});
