// Global score color rules — keep in sync across all candidate score displays.
// Fast Track purple matches StatusDropdown fast_track color (#a855f7).
export const FAST_TRACK_PURPLE = "#a855f7";

export const getScoreColor = (score: number | null | undefined): string => {
  const s = score ?? 0;
  if (s > 100) return FAST_TRACK_PURPLE; // bonus tier
  if (s >= 92) return "#4ade80";         // bright green
  if (s >= 85) return "#22c55e";         // darker green
  if (s >= 79) return "#facc15";         // bright yellow
  if (s >= 74) return "#eab308";         // darker yellow
  if (s >= 70) return "#f59e0b";         // orange
  if (s >= 65) return "#ef4444";         // red
  return "#991b1b";                       // muted red
};
