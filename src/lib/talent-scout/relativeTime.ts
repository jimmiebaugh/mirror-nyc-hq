// Phase 3.7.3.4: extracted from RoleDashboard for reuse on CandidateDetail.
// Returns short relative-time strings like "5h ago", "Yesterday", "3d ago".
// For dates more than 30 days old, falls back to month-precision ("3mo ago").
export const fmtRelative = (iso: string | null | undefined): string => {
  if (!iso) return "Never";
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return "Just now";
  const m = Math.floor(diff / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(diff / 3_600_000);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d === 1) return "Yesterday";
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  return `${mo}mo ago`;
};
