import { useState } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  /** lowercased before storing (subject keywords). */
  normalize?: boolean;
  /**
   * Phase 3.7.5: dedupe case-insensitively but PRESERVE the user's original
   * casing on the stored tag. Right for competitor lists where "MATTE
   * Projects" should not co-exist with "matte projects" but the canonical
   * brand casing matters.
   */
  caseInsensitiveDedup?: boolean;
};

export function TagInput({ value, onChange, placeholder, normalize, caseInsensitiveDedup }: Props) {
  const [input, setInput] = useState("");

  const add = () => {
    const v = input.trim();
    if (!v) return;
    const stored = normalize ? v.toLowerCase() : v;
    const ci = normalize || caseInsensitiveDedup;
    const exists = ci
      ? value.map((x) => x.toLowerCase()).includes(stored.toLowerCase())
      : value.includes(stored);
    if (!exists) onChange([...value, stored]);
    setInput("");
  };

  return (
    <div
      className={cn(
        "flex min-h-11 flex-wrap items-center gap-1.5 rounded-md border border-input bg-background p-1.5",
        "focus-within:outline-none focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2",
      )}
    >
      {value.map((k) => (
        <span
          key={k}
          className="inline-flex items-center gap-1.5 rounded bg-secondary px-2 py-1 text-xs font-medium text-secondary-foreground"
        >
          {k}
          <button
            type="button"
            onClick={() => onChange(value.filter((x) => x !== k))}
            className="text-muted-foreground hover:text-foreground"
            aria-label={`Remove ${k}`}
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <input
        className="h-7 min-w-[140px] flex-1 bg-transparent px-1.5 text-sm outline-none"
        placeholder={placeholder ?? "Add..."}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add();
          } else if (e.key === "Backspace" && !input && value.length) {
            onChange(value.slice(0, -1));
          }
        }}
        onBlur={add}
      />
    </div>
  );
}
