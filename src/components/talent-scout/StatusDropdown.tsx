import { useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import type { Database } from "@/integrations/supabase/types";

export type CandidateStatus = Database["public"]["Enums"]["ts_candidate_status"];

type Opt = { value: CandidateStatus; label: string; cls: string; aiOnly?: boolean };

// Manual options first, in admin-relevance order. auto_rejected is shown only
// when the AI set it; admins can't pick it manually (Source repo pattern).
// Status labels are past-tense states ("Rejected"); bulk-action buttons in
// CandidateTable are imperative verbs ("Reject") — distinct affordances.
const OPTIONS: Opt[] = [
  { value: "interview",     label: "Interview",     cls: "bg-cyan-500/10 text-cyan-400 border-cyan-500/40" },
  { value: "fast_track",    label: "Fast-Track",    cls: "bg-purple-500/10 text-purple-400 border-purple-500/40" },
  { value: "consider",      label: "Consider",      cls: "bg-amber-500/10 text-amber-400 border-amber-500/30" },
  { value: "reject",        label: "Rejected",      cls: "bg-red-500/10 text-red-400 border-red-500/40" },
  { value: "auto_rejected", label: "Auto-Rejected", cls: "bg-red-500/5 text-red-400/80 border-red-500/20", aiOnly: true },
];

export function statusStyle(v: string | null | undefined) {
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
    if (next === current) return;
    if (next === "auto_rejected") return; // safety: AI-only
    setSaving(true);
    // Await the DB update before calling onChange — otherwise the parent's
    // refetch races the write and reads the old value, leaving the dropdown
    // visually stuck on the previous status.
    const { error } = await supabase
      .from("ts_candidates")
      .update({ status: next as CandidateStatus })
      .eq("id", candidateId);
    setSaving(false);
    if (error) {
      toast({ title: "Status update failed", description: error.message, variant: "destructive" });
      return;
    }
    onChange?.(next as CandidateStatus);
  };

  const heightCls = size === "compact" ? "h-7 text-[11px]" : size === "large" ? "h-10 text-sm" : "h-9 text-xs";

  return (
    <Select value={current} onValueChange={onValueChange} disabled={saving}>
      <SelectTrigger className={cn("min-w-[140px] border font-bold uppercase tracking-wider", heightCls, opt.cls)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {OPTIONS.map((o) => (
          <SelectItem
            key={o.value}
            value={o.value}
            disabled={o.aiOnly && current !== o.value}
          >
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
