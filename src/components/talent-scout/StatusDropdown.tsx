import { useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import type { Database } from "@/integrations/supabase/types";

export type CandidateStatus = Database["public"]["Enums"]["ts_candidate_status"];

type Opt = { value: CandidateStatus; label: string; cls: string; colorHex: string };

// Manual options in admin-relevance order. Status labels are past-tense
// states ("Rejected"); bulk-action buttons in CandidateTable are imperative
// verbs ("Reject") — distinct affordances.
//
// colorHex is the solid 500-shade used for inline styling (row left-border
// in CandidateTable). cls is the Tailwind compound for the pill itself.
//
// Phase 3.7.2.1: auto_rejected dropped. manually_reviewed=false distinguishes
// AI-decided rejections from human-confirmed ones. AI rejection now writes
// status=reject + manually_reviewed=false (the AUTO pill signals it's still
// the AI's pick). The auto_rejected enum value remains in the DB for safety
// but new writes never use it.
const OPTIONS: Opt[] = [
  { value: "interview",  label: "Interview",  cls: "bg-cyan-500/10 text-cyan-500 border-cyan-500/40",       colorHex: "#06b6d4" },
  { value: "fast_track", label: "Fast-Track", cls: "bg-purple-500/10 text-purple-500 border-purple-500/40", colorHex: "#a855f7" },
  { value: "consider",   label: "Consider",   cls: "bg-amber-500/10 text-amber-500 border-amber-500/30",   colorHex: "#f59e0b" },
  { value: "reject",     label: "Rejected",   cls: "bg-red-500/10 text-red-500 border-red-500/40",         colorHex: "#ef4444" },
];

// Defensive fallback for any legacy auto_rejected row that the backfill
// missed: render with the same styling as 'reject'. statusStyle never
// returns this Opt to consumers — only used as a lookup for existing data.
const LEGACY_AUTO_REJECTED: Opt = {
  value: "auto_rejected",
  label: "Rejected",
  cls: "bg-red-500/10 text-red-500 border-red-500/40",
  colorHex: "#ef4444",
};

export function statusStyle(v: string | null | undefined) {
  if (v === "auto_rejected") return LEGACY_AUTO_REJECTED;
  return OPTIONS.find((o) => o.value === v) ?? OPTIONS[2]; // default = consider
}

export function StatusDropdown({
  candidateId,
  value,
  onChange,
  size = "default",
}: {
  candidateId: string;
  value: CandidateStatus | null | undefined;
  onChange?: (v: CandidateStatus) => void;
  size?: "compact" | "default" | "large";
}) {
  const current: CandidateStatus = value ?? "consider";
  const opt = OPTIONS.find((o) => o.value === current) ?? OPTIONS[2];
  const [saving, setSaving] = useState(false);

  const onValueChange = async (next: string) => {
    setSaving(true);
    // Phase 3.7.2: every dropdown action flips manually_reviewed → true.
    // This includes re-selecting the same status (interpreted as "user
    // confirmed the AI's pick"), so the early-return-on-same-value short
    // circuit was removed. status update is idempotent if next === current.
    // Await the DB update before calling onChange — otherwise the parent's
    // refetch races the write and reads the old value, leaving the dropdown
    // visually stuck on the previous status.
    const { error } = await supabase
      .from("ts_candidates")
      .update({ status: next as CandidateStatus, manually_reviewed: true })
      .eq("id", candidateId);
    setSaving(false);
    if (error) {
      toast({ title: "Status update failed", description: error.message, variant: "destructive" });
      return;
    }
    onChange?.(next as CandidateStatus);
  };

  // Phase 3.7.1.2: AUTO-REJECTED (longest label, 13 chars) was clipping.
  // tracking-wider → tracking-wide, min-w 128 → 140 to fit AUTO-REJECTED
  // with breathing room. CandidateTable's GRID_COLS bumped status column
  // 132 → 148 to match.
  // Phase 3.7.8.10: compact bumped from h-8 text-[11px] to h-9 text-[12px]
  // so the trigger reads alongside the (also bumped) ReviewedPill +
  // ReferralPill stacked below it. Status column elements all sit at
  // 12px text now.
  const heightCls = size === "compact" ? "h-9 text-[12px]" : size === "large" ? "h-10 text-sm" : "h-10 text-[13px]";
  const widthCls = size === "compact" ? "min-w-[140px]" : "min-w-[120px]";
  const trackingCls = size === "compact" ? "tracking-wide" : "tracking-wider";

  return (
    <Select value={current} onValueChange={onValueChange} disabled={saving}>
      {/* Phase 3.7.2.1: status text centered in the trigger. The SelectValue's
           span is forced flex-1 + text-center; pl-4 compensates for the
           chevron icon on the right so the visible text sits over the
           button's true horizontal midpoint. */}
      <SelectTrigger
        className={cn(
          widthCls,
          "border font-mono font-bold uppercase",
          trackingCls,
          heightCls,
          opt.cls,
          "[&>span]:flex-1 [&>span]:text-center [&>span]:pl-4",
        )}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {OPTIONS.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
