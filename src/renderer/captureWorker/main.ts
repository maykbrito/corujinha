// src/renderer/captureWorker/main.ts
const api = (window as any).api;

async function captureOnce(maxWidth = 1152, quality = 0.6): Promise<string> {
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 1 }, audio: false });
  try {
    const video = document.createElement("video");
    video.srcObject = stream;
    await video.play();
    // Wait for real dimensions before reading videoWidth/videoHeight — reading right
    // after play() can yield 0 on the first frame, producing a 0x0 canvas. Poll via
    // requestAnimationFrame so we can't miss a one-shot event (race-free).
    await waitForDimensions(video);
    const vw = video.videoWidth, vh = video.videoHeight;
    const scale = Math.min(1, maxWidth / vw);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(vw * scale);
    canvas.height = Math.round(vh * scale);
    canvas.getContext("2d")!.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/webp", quality);
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

api.on("capture:do", async (requestId: string) => {
  try {
    const dataUrl = await captureOnce();
    api.invoke("capture:result", requestId, { ok: true, dataUrl });
  } catch (e) {
    api.invoke("capture:result", requestId, { ok: false, error: String(e) });
  }
});
