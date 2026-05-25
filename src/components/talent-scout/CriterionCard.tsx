import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import type { Criterion } from "@/lib/talent-scout/wizardStore";
import { cn } from "@/lib/utils";

/**
 * Phase 3.7.6: extracted from NewRoleScorecard so RoleSettings can reuse
 * the same editor row.
 *
 * Phase 3.7.6.4 restyle (per Jimmie, ref source repo's RoleSettings):
 *  - Smaller name (text-[12px] / font-semibold) + smaller describer
 *    (text-[11px] muted) — tighter row, more rows fit per screen.
 *  - Weight input narrowed 90px → 64px and shortened (h-8).
 *  - Disqualifier label "Disqualify if missing" → "DQ", checkbox
 *    sits beside the weight input rather than its own column.
 *  - Right side now: weight input · "pts" · DQ checkbox (T1 only) ·
 *    remove button (manual only).
 */
export function CriterionCard({
  c,
  onChange,
  onRemove,
}: {
  c: Criterion;
  onChange: (p: Partial<Criterion>) => void;
  onRemove: () => void;
}) {
  const points = Number(c.weight) || 0;
  // Phase 3.7.6.5: describer is now a textarea so long text wraps onto
  // multiple lines instead of getting clipped behind the right-side
  // weight + DQ cluster. Auto-grow via scrollHeight on every render so
  // the field is always tall enough to show all text without scrolling.
  const describerRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    const el = describerRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [c.full_points_rubric]);
  return (
    <div
      className={cn(
        // Phase 3.7.6.9: padding p-3 → p-4 and text bumped a step up to
        // match the larger Scorecard card on RoleSettings (see ScorecardEditor
        // changes). Wizard step 3 picks up the same sizing automatically.
        "flex items-center gap-6 rounded-md border border-border bg-card p-4",
        c.is_manual && "border-l-2 border-l-primary",
      )}
    >
      {/* Name + describer stack — flex-1 so the describer textbox is as
          wide as possible after the right input column takes its slice. */}
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center gap-2">
          <input
            value={c.name}
            onChange={(e) => onChange({ name: e.target.value })}
            className="w-full bg-transparent text-[13px] font-semibold outline-none focus:border-b focus:border-primary"
          />
          {c.is_manual && (
            <span className="inline-block rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-bold uppercase text-primary">
              Manual
            </span>
          )}
        </div>
        <textarea
          ref={describerRef}
          rows={1}
          value={c.full_points_rubric}
          onChange={(e) => onChange({ full_points_rubric: e.target.value })}
          placeholder="Describer: what does this criterion measure?"
          className="w-full resize-none overflow-hidden bg-transparent text-[12px] leading-[1.4] text-muted-foreground outline-none focus:border-b focus:border-primary"
        />
      </div>

      {/* Right column — vertical stack:
          [pts input]
          [coral X pts]
          [DQ checkbox]      ← Phase 3.7.6.7: stacked under input
          All centered horizontally within the column. Remove button (X)
          floats to the far right of the row, vertically centered. */}
      <div className="flex flex-shrink-0 flex-col items-center gap-1.5">
        <Input
          type="number"
          min={0}
          value={c.weight}
          onChange={(e) => onChange({ weight: Number(e.target.value) || 0 })}
          className="h-8 w-[64px] text-center text-[13px] font-bold"
        />
        <span className="text-[11px] font-extrabold tabular-nums text-primary whitespace-nowrap">
          {points} pts
        </span>
        {c.tier === 1 && (
          <label className="flex cursor-pointer items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
            <Checkbox
              checked={c.is_disqualifier}
              onCheckedChange={(v) => onChange({ is_disqualifier: !!v })}
            />
            DQ
          </label>
        )}
      </div>

      {c.is_manual && (
        <button
          type="button"
          onClick={onRemove}
          className="flex-shrink-0 text-muted-foreground hover:text-foreground"
          title="Remove"
          aria-label="Remove criterion"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
