/**
 * Last Active relative-time helper for the Team page (Surface 12) and
 * Settings Admins card (Surface 20). Maps a timestamp into:
 *   "Just now"  (< 1 min)
 *   "Today"     (same calendar day, > 1 min ago)
 *   "Yesterday" (1 calendar day ago)
 *   "N days ago" (2-13 days)
 *   "N weeks ago" (2-8 weeks)
 *   "Months ago" (longer)
 *   "Never"     (null)
 */
export function formatLastActive(iso: string | null | undefined): string {
  if (!iso) return "Never";
  const then = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - then.getTime();
  if (diffMs < 60_000) return "Just now";

  const startOfThen = new Date(then.getFullYear(), then.getMonth(), then.getDate()).getTime();
  const startOfNow = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dayDiff = Math.round((startOfNow - startOfThen) / 86_400_000);

  if (dayDiff === 0) return "Today";
  if (dayDiff === 1) return "Yesterday";
  if (dayDiff < 14) return `${dayDiff} days ago`;
  if (dayDiff < 60) {
    const w = Math.floor(dayDiff / 7);
    return `${w} week${w === 1 ? "" : "s"} ago`;
  }
  const m = Math.floor(dayDiff / 30);
  return `${m} month${m === 1 ? "" : "s"} ago`;
}
