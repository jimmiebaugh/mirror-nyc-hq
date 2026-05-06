// Canonical "In Pool" definition. Used everywhere we count or filter pool candidates.
// "interview" is in pool (active candidate). "hired" is NOT (position filled).
// "rejected" (manual) and "auto_rejected" (AI) are NOT in pool.
export const IN_POOL_STATUSES = [
  "interview",
  "fast_track",
  "consider",
  "reviewed",
] as const;

export const isInPool = (status: string | null | undefined): boolean =>
  !!status && (IN_POOL_STATUSES as readonly string[]).includes(status);

// Canonical sort priority. Lower = higher in list. Within each group, sort by total_score DESC.
export const statusPriority = (s: string | null | undefined): number => {
  switch (s) {
    case "interview": return 1;
    case "fast_track": return 2;
    case "consider":
    case "under_consideration": return 3;
    case "reviewed":
    case "reviewed_no_decision": return 4;
    case "hired": return 5;
    case "rejected": return 6;
    case "auto_rejected": return 7;
    default: return 8;
  }
};

export const isRejected = (s: string | null | undefined): boolean =>
  s === "rejected" || s === "auto_rejected";

// Sort a candidate list by status priority, then by total_score DESC.
export const sortByStatusThenScore = <T extends { status: string | null; total_score?: number | null }>(list: T[]): T[] => {
  return [...list].sort((a, b) => {
    const pa = statusPriority(a.status);
    const pb = statusPriority(b.status);
    if (pa !== pb) return pa - pb;
    const sa = a.total_score ?? -Infinity;
    const sb = b.total_score ?? -Infinity;
    return sb - sa;
  });
};
