import { useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { CELL_INPUT_CLASS, type CellEditorProps } from "./types";

/**
 * Long-text cell. Renders a compact single-line preview; clicking opens a
 * Popover with a full Textarea that commits on close. No shipping 5.9.2 entity
 * uses longText (the smoke surface's Notes column does), so this stays light.
 */
export function LongTextCell({ value, onCommit }: CellEditorProps) {
  const [open, setOpen] = useState(false);
  const text = value == null ? "" : String(value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className={`${CELL_INPUT_CLASS} truncate text-left`}>
          {text || <span className="text-muted-foreground">—</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-2">
        <Textarea
          autoFocus
          rows={5}
          value={text}
          onChange={(e) => onCommit(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
