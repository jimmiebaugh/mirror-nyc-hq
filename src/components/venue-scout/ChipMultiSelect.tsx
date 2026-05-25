// Toggleable chip multi-select for Venue Type on BriefVenue + BriefReport.
//
// Phase 5.12.10 follow-on: chips now source from the runtime `public.venue_types`
// lookup via `useLookup("venue_types")`, replacing the pre-5.12.10 hard-coded
// `CANONICAL_VENUE_TYPE_CHIPS` array. Producer adds via the "+ Other..." input
// INSERT into `public.venue_types` (open RLS to authenticated; same pattern
// cities + neighborhoods use), so a new tag flows to every VS surface
// immediately + survives forever. Stale per-brief tokens (legacy intake
// strings like "Pop-up retail" / "Industrial / warehouse" from pre-5.12.10
// briefs, or admin-deleted lookup rows still stored on a brief) render with
// the selected styling + X-remove affordance so the producer can drop them
// without re-adding to the lookup.
//
// Styled with HQ tokens: selected chips read success green (Phase 5.12.14.1
// Stage 2C F6.4 flip — "selected" is a completion-style affordance, distinct
// from the coral CTA primary), unselected read muted on bg-input so they
// stay visible on bg-surface-alt cards.
import { useState } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLookup } from "@/lib/hq/lookups";

// R6 § A.2 + § A.3 → R6 amendment v1 § 3: chip text lands at 13px as the
// canonical chip-pill size sitewide. Combobox option rows (RecordCombobox
// CommandItem) stay at 15px per R6 § A.3; only the chip-pill surface
// drops to 13px. Applies to canonical + stale + "+ Other..." chips.
const CHIP_BASE =
  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] font-medium transition-colors";

export function ChipMultiSelect({
  value,
  onChange,
  disabled,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}) {
  const { options, addOption } = useLookup("venue_types");
  const canonicalNames = options.map((o) => o.name);
  const [otherOpen, setOtherOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Case-insensitive toggle. Clicking a canonical chip whose case-variant is
  // already in `value` (e.g. legacy "retail" while runtime exposes "Retail")
  // first-click REMOVES the variant; a second click adds the canonical case.
  // Two clicks normalize the stored value over time without an explicit
  // backfill.
  const toggle = (chip: string) => {
    const lower = chip.toLowerCase();
    if (value.some((v) => v.toLowerCase() === lower)) {
      onChange(value.filter((v) => v.toLowerCase() !== lower));
    } else {
      onChange([...value, chip]);
    }
  };

  // "+ Other..." inline-add. Adds to public.venue_types via useLookup's
  // addOption (which mutates the shared cache + notifies subscribers so
  // every other VS surface picks up the new option immediately). On a
  // case-variant collision (DB LOWER unique index throws 23505 caught by
  // addOption + null return), re-resolve against the cache case-insensitively
  // and select the canonical-cased winner. Falls back to pushing the trimmed
  // input as a stale per-brief chip if nothing resolves so the producer
  // doesn't lose their typing.
  const commitOther = async () => {
    const v = draft.trim();
    setDraft("");
    setOtherOpen(false);
    if (!v) return;
    const lower = v.toLowerCase();
    // Already selected (any casing): no-op.
    if (value.some((sel) => sel.toLowerCase() === lower)) return;
    // Already in the canonical set: select the canonical-cased option.
    const existing = canonicalNames.find((n) => n.toLowerCase() === lower);
    if (existing) {
      onChange([...value, existing]);
      return;
    }
    setSubmitting(true);
    const created = await addOption(v);
    setSubmitting(false);
    if (created) {
      onChange([...value, created.name]);
      return;
    }
    // addOption returned null. Re-resolve against the cache (a concurrent
    // caller may have inserted a case-variant); else stale per-brief chip.
    const reFetched = canonicalNames.find((n) => n.toLowerCase() === lower);
    onChange([...value, reFetched ?? v]);
  };

  // Stale per-brief chips: selected values NOT in the runtime canonical set
  // (legacy intake strings; admin-deleted types still stored on a brief).
  // Render with the same selected styling + X-remove affordance so the
  // producer can drop them. Comparison is case-insensitive so a canonical-
  // cased lookup row doesn't double-render its lowercase legacy variant.
  const lowerSet = new Set(canonicalNames.map((n) => n.toLowerCase()));
  const staleChips = value.filter((v) => !lowerSet.has(v.toLowerCase()));

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2",
        disabled && "pointer-events-none opacity-60",
      )}
    >
      {canonicalNames.map((chip) => {
        const selected = value.some(
          (v) => v.toLowerCase() === chip.toLowerCase(),
        );
        return (
          <button
            key={chip}
            type="button"
            onClick={() => toggle(chip)}
            className={cn(
              CHIP_BASE,
              selected
                ? "border-success bg-success/15 text-success"
                : "border-border bg-input text-muted-foreground hover:border-primary/50 hover:text-foreground",
            )}
          >
            {chip}
          </button>
        );
      })}

      {staleChips.map((chip) => (
        <span
          key={chip}
          className={cn(CHIP_BASE, "border-success bg-success/15 text-success")}
        >
          {chip}
          <button
            type="button"
            onClick={() => onChange(value.filter((c) => c !== chip))}
            className="text-success/70 hover:text-success"
            aria-label={`Remove ${chip}`}
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}

      {otherOpen ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void commitOther();
            } else if (e.key === "Escape") {
              setDraft("");
              setOtherOpen(false);
            }
          }}
          onBlur={() => void commitOther()}
          placeholder="Type a venue type…"
          disabled={submitting}
          className="h-8 min-w-[160px] rounded-full border border-primary/50 bg-background px-3 text-[13px] outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
        />
      ) : (
        <button
          type="button"
          onClick={() => setOtherOpen(true)}
          className={cn(
            CHIP_BASE,
            "border-dashed border-border bg-transparent text-muted-foreground hover:border-primary/50 hover:text-foreground",
          )}
        >
          + Other…
        </button>
      )}
    </div>
  );
}
