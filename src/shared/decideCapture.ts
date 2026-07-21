// src/shared/decideCapture.ts
export function decideCapture(o: { hasRegion: boolean; sendScreen: boolean }): "region" | "full" | "none" {
  if (o.hasRegion) return "region";
  return o.sendScreen ? "full" : "none";
}
