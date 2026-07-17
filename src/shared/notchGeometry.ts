export const NOTCH = {
  COLLAPSED_W: 300,
  COLLAPSED_H: 34,
  DEFAULT_W: 436,
  DEFAULT_H: 212,
  MIN_W: 360,
  MIN_H: 160,
  MAX_W: 900,
  MAX_H: 640,
  MIN_OPACITY: 0.45,
  MAX_OPACITY: 1,
  SNAP_PX: 150,
} as const;

export interface Size { width: number; height: number; }
export interface Point { x: number; y: number; }
export interface Rect { x: number; y: number; width: number; height: number; }

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

export function clampSize(s: Size): Size {
  return {
    width: clamp(Math.round(s.width), NOTCH.MIN_W, NOTCH.MAX_W),
    height: clamp(Math.round(s.height), NOTCH.MIN_H, NOTCH.MAX_H),
  };
}
export function clampOpacity(v: number): number {
  return clamp(Math.round(v * 100) / 100, NOTCH.MIN_OPACITY, NOTCH.MAX_OPACITY);
}
export function snapDistance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
export function notchBounds(area: Rect, width: number): Rect {
  return {
    x: area.x + Math.round((area.width - width) / 2),
    y: area.y,
    width,
    height: NOTCH.COLLAPSED_H,
  };
}
