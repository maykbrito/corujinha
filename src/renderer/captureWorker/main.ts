// src/renderer/captureWorker/main.ts
const api = (window as any).api;

async function captureOnce(maxWidth = 1152, quality = 0.6): Promise<string> {
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 1 }, audio: false });
  const track = stream.getVideoTracks()[0];
  const video = document.createElement("video");
  video.srcObject = stream;
  await video.play();
  // Wait for real dimensions before reading videoWidth/videoHeight — reading right
  // after play() can yield 0 on the first frame, producing a 0x0 canvas.
  if (!video.videoWidth || !video.videoHeight) {
    await new Promise<void>((resolve) => {
      if (video.videoWidth && video.videoHeight) return resolve();
      video.addEventListener("loadedmetadata", () => resolve(), { once: true });
    });
  }
  const vw = video.videoWidth, vh = video.videoHeight;
  const scale = Math.min(1, maxWidth / vw);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(vw * scale);
  canvas.height = Math.round(vh * scale);
  canvas.getContext("2d")!.drawImage(video, 0, 0, canvas.width, canvas.height);
  track.stop();
  return canvas.toDataURL("image/webp", quality);
}

api.on("capture:do", async (requestId: string) => {
  try {
    const dataUrl = await captureOnce();
    api.invoke("capture:result", requestId, { ok: true, dataUrl });
  } catch (e) {
    api.invoke("capture:result", requestId, { ok: false, error: String(e) });
  }
});
