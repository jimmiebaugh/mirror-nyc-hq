// Phase 4 Revision - Intake: minimal controlled tag input for the brief flow.
// Used by Objectives, Target Neighborhoods, and Ideal Features.
//
// Deliberately minimal: no autocomplete, no async, no normalization. Just a
// controlled string[] plus a draft input that commits on Enter or comma.
// Blur also commits and Backspace on an empty draft removes the last tag --
// both match the established Talent Scout TagInput so producers get the same
// muscle memory and don't lose a half-typed tag when they click Continue.
//
// Styled with HQ tokens: pills use bg-input (not bg-secondary) so they stay
// visible on bg-surface-alt cards (design-system § 12 rule 1).
//
// Phase 5.12.14: compact variant for matrix-row cells (Sourcing + Shortlist
// Features column). When `compact=true`, the container chrome (border /
// background / padding) drops, chips stack vertically (one per row, single
// chip wide), and the always-visible input is replaced with a reveal-on-click
// coral "+" affordance pinned on its own line below the last chip.
// The default (compact=false) is byte-unchanged for BriefVenue + BriefReport.
import { useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";

export function TagInput({
  value,
  onChange,
  placeholder,
  disabled,
  compact,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
  compact?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const [addingCompact, setAddingCompact] = useState(false);
  const compactInputRef = useRef<HTMLInputElement | null>(null);

  const commit = () => {
    const v = draft.trim();
    if (!v) {
      setDraft("");
      if (compact) setAddingCompact(false);
      return;
    }
    if (!value.includes(v)) onChange([...value, v]);
    setDraft("");
    if (compact) setAddingCompact(false);
  };

  const remove = (tag: string) => onChange(value.filter((t) => t !== tag));

  if (compact) {
    // Two flex-1 spacers around the chip group put the chip group's vertical
    // center exactly at cell center (regardless of chip count). The add-tag
    // affordance sits inside the bottom spacer with a small pt-2 gap, so it
    // hangs just below the last chip without affecting chip-group centering.
    return (
      <div
        className={cn(
          "flex h-full flex-col items-center",
          disabled && "pointer-events-none opacity-60",
        )}
      >
        <div className="flex-1" />
        <div className="flex flex-col items-center gap-1.5">
          {value.map((tag) => (
            <span
              key={tag}
              className="inline-flex max-w-full items-center gap-1.5 rounded bg-input px-3 py-1 text-[13px] font-medium text-foreground"
            >
              <span className="truncate">{tag}</span>
              <button
                type="button"
                onClick={() => remove(tag)}
                className="text-muted-foreground hover:text-foreground"
                aria-label={`Remove ${tag}`}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
        <div className="flex flex-1 flex-col items-center pt-2">
          {addingCompact ? (
            <input
              ref={compactInputRef}
              autoFocus
              className="h-7 w-full bg-transparent px-1.5 text-center text-sm outline-none"
              placeholder={placeholder ?? "Add tag"}
              value={draft}
              disabled={disabled}
              onChange={(e) => {
                const next = e.target.value;
                if (next.includes(",")) {
                  const v = next.replace(/,/g, "").trim();
                  if (v && !value.includes(v)) onChange([...value, v]);
                  setDraft("");
                  setAddingCompact(false);
                  return;
                }
                setDraft(next);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commit();
                } else if (e.key === "Escape") {
                  setDraft("");
                  setAddingCompact(false);
                } else if (e.key === "Backspace" && !draft && value.length) {
                  onChange(value.slice(0, -1));
                }
              }}
              onBlur={commit}
            />
          ) : (
            <button
              type="button"
              onClick={() => setAddingCompact(true)}
              disabled={disabled}
              aria-label="Add tag"
              className="inline-flex h-7 w-7 items-center justify-center rounded text-primary hover:text-primary-hover transition-colors"
            >
              <Plus className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex min-h-11 flex-wrap items-center gap-1.5 rounded-md border border-input bg-background p-1.5",
        "focus-within:outline-none focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2",
        disabled && "pointer-events-none opacity-60",
      )}
    >
      {value.map((tag) => (
        <span
          key={tag}
          className="inline-flex items-center gap-1.5 rounded bg-input px-2 py-1 text-[13px] font-medium text-foreground"
        >
          {tag}
          <button
            type="button"
            onClick={() => remove(tag)}
            className="text-muted-foreground hover:text-foreground"
            aria-label={`Remove ${tag}`}
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <input
        className="h-7 min-w-[140px] flex-1 bg-transparent px-1.5 text-sm outline-none disabled:cursor-not-allowed"
        placeholder={placeholder ?? "Type and press Enter…"}
        value={draft}
        disabled={disabled}
        onChange={(e) => {
          const next = e.target.value;
          // Comma is a commit key: strip it and commit the draft so far.
          if (next.includes(",")) {
            const v = next.replace(/,/g, "").trim();
            if (v && !value.includes(v)) onChange([...value, v]);
            setDraft("");
            return;
          }
          setDraft(next);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Backspace" && !draft && value.length) {
            onChange(value.slice(0, -1));
          }
        }}
        onBlur={commit}
      />
    </div>
  );
}
