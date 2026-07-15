// src/shared/session/pagination.ts
export function clampIndex(i: number, total: number): number {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(i, total - 1));
}
export interface Page<T> { item: T | null; index: number; total: number; hasPrev: boolean; hasNext: boolean; }
export function pageFor<T>(items: T[], index: number): Page<T> {
  const total = items.length;
  if (total === 0) return { item: null, index: 0, total: 0, hasPrev: false, hasNext: false };
  const i = clampIndex(index, total);
  return { item: items[i], index: i, total, hasPrev: i > 0, hasNext: i < total - 1 };
}
