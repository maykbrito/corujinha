// src/shared/cropRect.ts
// Map an overlay selection (CSS points on a display) to a pixel rect inside the
// captured frame. The frame may be scaled differently from points (HiDPI, or the
// captured video is not exactly display-native), so derive scale from frame/point ratio.
export interface Rect { x: number; y: number; w: number; h: number; }
export interface DisplayInfo { pointW: number; pointH: number; }
export interface FrameInfo { frameW: number; frameH: number; }

export function toPixelCrop(sel: Rect, disp: DisplayInfo, frame: FrameInfo): Rect {
  const sx = frame.frameW / disp.pointW; // frame pixels per CSS point (x)
  const sy = frame.frameH / disp.pointH;
  let x = Math.round(sel.x * sx);
  let y = Math.round(sel.y * sy);
  let w = Math.round(sel.w * sx);
  let h = Math.round(sel.h * sy);
  // clamp origin, then size, to the frame
  x = Math.min(Math.max(0, x), frame.frameW);
  y = Math.min(Math.max(0, y), frame.frameH);
  w = Math.min(Math.max(1, w), frame.frameW - x);
  h = Math.min(Math.max(1, h), frame.frameH - y);
  return { x, y, w, h };
}
