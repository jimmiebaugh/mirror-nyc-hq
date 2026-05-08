import { cn } from "@/lib/utils";

/**
 * Phase 3.7.7: pill that lives next to ReviewedPill under the status
 * dropdown. Renders only when ts_candidates.is_referral is true.
 * Read-only — flag is set during ingestion (ts-pull-candidates detected
 * a forward from a Mirror manager) and isn't toggleable from the UI.
 *
 * Phase 3.7.8.8: tried solid coral + white bold; reverted in 3.7.8.13
 * because coral blended into too many other coral surfaces in the
 * dashboard (Master Pool header, toasts, primary buttons). Back to the
 * original electric blue, which stands cleanly apart from the
 * muted-grey AUTO/MANUAL pill it sits beside.
 *
 * When both pills are present, each takes flex-1 so they split the
 * status column 50/50 (compact) or each fills its half (large).
 */
export function ReferralPill({
  size = "compact",
  referrerEmail,
}: {
  size?: "compact" | "large";
  /** Manager who forwarded the candidate. Surfaced as the title tooltip
   *  ("Forwarded by sarah@mirrornyc.com"). */
  referrerEmail?: string | null;
}) {
  // Phase 3.7.8.10: compact bumped to h-8 text-[12px] so it matches the
  // (also bumped) ReviewedPill it sits beside, under the StatusDropdown.
  const heightCls = size === "large" ? "h-7 text-[11px]" : "h-8 text-[12px]";
  return (
    <span
      title={referrerEmail ? `Forwarded by ${referrerEmail}` : "Referral"}
      className={cn(
        "inline-flex flex-1 min-w-0 items-center justify-center rounded-sm border font-mono font-bold uppercase tracking-wide",
        "border-blue-500/40 bg-blue-500/10 text-blue-400",
        heightCls,
      )}
    >
      Referral
    </span>
  );
}
