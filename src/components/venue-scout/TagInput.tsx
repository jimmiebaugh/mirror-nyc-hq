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
import { useState } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export function TagInput({
  value,
  onChange,
  placeholder,
  disabled,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState("");

  const commit = () => {
    const v = draft.trim();
    if (!v) {
      setDraft("");
      return;
    }
    if (!value.includes(v)) onChange([...value, v]);
    setDraft("");
  };

  const remove = (tag: string) => onChange(value.filter((t) => t !== tag));

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
          className="inline-flex items-center gap-1.5 rounded bg-input px-2 py-1 text-xs font-medium text-foreground"
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
