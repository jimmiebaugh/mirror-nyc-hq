import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "@/hooks/use-toast";
import type { StatusToken } from "@/lib/home/projectStatusToken";

/**
 * Click-to-edit status pill for DataTable rows (Phase 5.6.1 spec § 4.C).
 *
 * Renders an `.hq-pill .hq-pill--<token>` trigger that, when clicked,
 * opens a popover listing every valid value for the column with a
 * token-coloured dot per row. Picking an option fires an optimistic UI
 * update, awaits the parent's `onSave`, toasts on success, and reverts
 * with a destructive toast on failure. `stopPropagation` keeps the
 * underlying row's click-to-detail handler from firing.
 *
 * No confirm dialog: lightweight single-field mutations are reserved from
 * the confirm pattern (locked-decisions § 7). Realtime subscriptions on
 * the host list page handle cross-tab sync; this component only owns the
 * optimistic local-state hop.
 */

type ClickPillCellProps = {
  value: string;
  options: readonly string[];
  tokenMap: (status: string) => StatusToken;
  onSave: (next: string) => Promise<void>;
  /**
   * Phase 5.7.3 followup-7: optional `lg` size for detail-page header
   * placements where the pill needs to read at title scale. Default keeps
   * the existing 5.6.1 cell size for DataTable use.
   */
  size?: "default" | "lg";
};

function tokenColor(token: StatusToken): string {
  switch (token) {
    case "info":
      return "#06B6D4";
    case "success":
      return "hsl(var(--success))";
    case "warn":
      return "hsl(var(--warn))";
    case "destructive":
      return "hsl(var(--destructive))";
    case "muted":
    default:
      return "hsl(var(--muted-foreground))";
  }
}

export function ClickPillCell({ value, options, tokenMap, onSave, size = "default" }: ClickPillCellProps) {
  const [open, setOpen] = useState(false);
  const [localValue, setLocalValue] = useState(value);

  // Sync from props when the Realtime subscription updates the parent row.
  // Avoids a stale optimistic value sticking around after a peer's write.
  if (value !== localValue && !open) {
    setLocalValue(value);
  }

  const currentToken = tokenMap(localValue);

  const handlePick = async (next: string) => {
    setOpen(false);
    if (next === localValue) return;
    const previous = localValue;
    setLocalValue(next);
    try {
      await onSave(next);
      toast({ title: "Updated" });
    } catch (err) {
      setLocalValue(previous);
      const message = err instanceof Error ? err.message : "Please try again.";
      toast({ title: "Update failed", description: message, variant: "destructive" });
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`hq-pill hq-pill--${currentToken} ${size === "lg" ? "hq-pill-lg" : ""} cursor-pointer`}
          onClick={(e) => e.stopPropagation()}
        >
          <span className="hq-pill-dt" />
          {localValue}
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[180px] p-1 bg-popover"
        align="start"
        sideOffset={4}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col gap-0.5">
          {options.map((opt) => {
            const optToken = tokenMap(opt);
            const isCurrent = opt === localValue;
            return (
              <button
                key={opt}
                type="button"
                className={`flex items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted/40 ${
                  isCurrent ? "bg-muted/20 font-medium" : ""
                }`}
                onClick={() => handlePick(opt)}
              >
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ backgroundColor: tokenColor(optToken) }}
                />
                {opt}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
