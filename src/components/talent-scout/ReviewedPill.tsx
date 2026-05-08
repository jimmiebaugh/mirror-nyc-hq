import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

/**
 * Phase 3.7.2: small grey pill that lives under the status dropdown on
 * CandidateTable rows and CandidateDetail. Renders "AUTO" when
 * manually_reviewed=false, "MANUAL" when true. Clicking AUTO flips it to
 * MANUAL (one-way; can't revert).
 *
 * Phase 3.7.5 will pair this with a ReferralPill in the same flex row;
 * when both are present, each takes 50% of the status column width.
 */
export function ReviewedPill({
  manuallyReviewed,
  candidateId,
  onChanged,
  size = "compact",
}: {
  manuallyReviewed: boolean;
  candidateId: string;
  onChanged?: () => void | Promise<void>;
  size?: "compact" | "large";
}) {
  const [busy, setBusy] = useState(false);
  const flip = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (busy || manuallyReviewed) return; // one-way only
    setBusy(true);
    const { error } = await supabase
      .from("ts_candidates")
      .update({ manually_reviewed: true })
      .eq("id", candidateId);
    setBusy(false);
    if (error) {
      toast({ title: "Update failed", description: error.message, variant: "destructive" });
      return;
    }
    await onChanged?.();
  };
  const label = manuallyReviewed ? "MANUAL" : "AUTO";
  const clickable = !manuallyReviewed;
  // Phase 3.7.8.10: compact bumped from h-6 text-[10px] to h-8 text-[12px]
  // so the AUTO/MANUAL pill reads at the same 12px size as the
  // ReferralPill it sits beside, both under the StatusDropdown.
  const heightCls = size === "large" ? "h-7 text-[11px]" : "h-8 text-[12px]";
  return (
    <button
      type="button"
      disabled={busy || !clickable}
      onClick={flip}
      title={clickable ? "Click to mark as manually reviewed" : "Manually reviewed"}
      className={cn(
        "inline-flex flex-1 min-w-0 items-center justify-center rounded-sm border font-mono font-bold uppercase tracking-wide transition-colors",
        "border-muted-foreground/30 bg-muted/40 text-muted-foreground",
        heightCls,
        clickable && "cursor-pointer hover:bg-muted/60 hover:text-foreground",
        !clickable && "cursor-default opacity-90",
      )}
    >
      {label}
    </button>
  );
}
