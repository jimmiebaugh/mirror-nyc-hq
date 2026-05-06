import { useState } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  /** lowercased before storing (subject keywords). */
  normalize?: boolean;
};

export function TagInput({ value, onChange, placeholder, normalize }: Props) {
  const [input, setInput] = useState("");

  const add = () => {
    const v = input.trim();
    if (!v) return;
    const norm = normalize ? v.toLowerCase() : v;
    const exists = normalize
      ? value.map((x) => x.toLowerCase()).includes(norm.toLowerCase())
      : value.includes(norm);
    if (!exists) onChange([...value, norm]);
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
