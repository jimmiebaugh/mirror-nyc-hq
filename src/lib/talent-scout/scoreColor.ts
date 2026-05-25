// Global score color rules — keep in sync across all candidate score displays.
// Keep scores on HQ semantic tokens so inline bars match the system palette.
export const FAST_TRACK_PURPLE = "hsl(var(--purple))";

export const getScoreColor = (score: number | null | undefined): string => {
  const s = score ?? 0;
  if (s > 100) return FAST_TRACK_PURPLE; // bonus tier
  if (s >= 85) return "hsl(var(--success))";
  if (s >= 70) return "hsl(var(--warn))";
  return "hsl(var(--destructive))";
};
