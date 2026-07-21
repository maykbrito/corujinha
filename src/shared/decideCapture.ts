// src/shared/decideCapture.ts
export type CaptureMode = "region" | "full" | "none";
export function decideCapture(o: { hasRegion: boolean; sendScreen: boolean }): CaptureMode {
  if (o.hasRegion) return "region";
  return o.sendScreen ? "full" : "none";
}
