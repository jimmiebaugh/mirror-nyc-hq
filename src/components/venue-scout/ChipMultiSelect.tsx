// Phase 4 Revision - Intake: toggleable chip multi-select for Venue Type.
//
// Six canonical chips plus a "+ Other..." affordance that opens an inline
// free-text input. A custom value is stored as just another entry in the
// selected string[] -- there is no persistent custom-chip palette, so a
// custom chip exists only for the brief it was added to. Toggling a custom
// chip off removes it entirely; toggling a canonical chip off just returns
// it to the unselected state (the canonical chip itself always renders).
//
// Styled with HQ tokens: selected chips read coral, unselected read muted on
// bg-input so they stay visible on bg-surface-alt cards.
import { useState } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export const CANONICAL_VENUE_TYPE_CHIPS = [
  "Pop-up retail",
  "Event venue",
  "Industrial / warehouse",
  "Gallery / white box",
  "Outdoor spaces",
  "Street / mobile",
] as const;

const CHIP_BASE =
  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors";

export function ChipMultiSelect({
  value,
  onChange,
  disabled,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}) {
  const [otherOpen, setOtherOpen] = useState(false);
  const [draft, setDraft] = useState("");

  const toggle = (chip: string) => {
    if (value.includes(chip)) onChange(value.filter((c) => c !== chip));
    else onChange([...value, chip]);
  };

  const commitOther = () => {
    const v = draft.trim();
    if (v && !value.includes(v)) onChange([...value, v]);
    setDraft("");
    setOtherOpen(false);
  };

  // Custom chips: selected values not in the canonical list.
  const customChips = value.filter(
    (v) => !(CANONICAL_VENUE_TYPE_CHIPS as readonly string[]).includes(v),
  );

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2",
        disabled && "pointer-events-none opacity-60",
      )}
    >
      {CANONICAL_VENUE_TYPE_CHIPS.map((chip) => {
        const selected = value.includes(chip);
        return (
          <button
            key={chip}
            type="button"
            onClick={() => toggle(chip)}
            className={cn(
              CHIP_BASE,
              selected
                ? "border-primary bg-primary/15 text-primary"
                : "border-border bg-input text-muted-foreground hover:border-primary/50 hover:text-foreground",
            )}
          >
            {chip}
          </button>
        );
      })}

      {customChips.map((chip) => (
        <span
          key={chip}
          className={cn(CHIP_BASE, "border-primary bg-primary/15 text-primary")}
        >
          {chip}
          <button
            type="button"
            onClick={() => onChange(value.filter((c) => c !== chip))}
            className="text-primary/70 hover:text-primary"
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
              commitOther();
            } else if (e.key === "Escape") {
              setDraft("");
              setOtherOpen(false);
            }
          }}
          onBlur={commitOther}
          placeholder="Type a venue type…"
          className="h-8 min-w-[160px] rounded-full border border-primary/50 bg-background px-3 text-xs outline-none focus:ring-2 focus:ring-ring"
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
