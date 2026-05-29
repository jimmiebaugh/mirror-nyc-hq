import { Button } from "@/components/ui/button";

/**
 * Sticky bottom action bar for the bulk-import wizard. Wraps the design-
 * system § 3 sticky-bar pattern with Back / Next semantics tuned for the
 * 5-step wizard. The `dirty` indicator surfaces when there are unsaved
 * edits in the active step.
 */
export function StickyActionBar({
  onBack,
  onNext,
  onCancel,
  nextLabel = "Next",
  nextDisabled = false,
  backDisabled = false,
  loading = false,
  dirty = false,
  destructive = false,
}: {
  onBack: () => void;
  onNext: () => void;
  onCancel?: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
  backDisabled?: boolean;
  loading?: boolean;
  dirty?: boolean;
  destructive?: boolean;
}) {
  return (
    <div className="actionbar">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-6 py-4">
        <div className="flex items-center gap-3">
          {onCancel ? (
            <Button variant="ghost" onClick={onCancel} type="button">
              Cancel
            </Button>
          ) : null}
          <Button
            variant="ghost"
            onClick={onBack}
            disabled={backDisabled || loading}
            type="button"
          >
            ← Back
          </Button>
        </div>
        <div className="flex items-center gap-3">
          {dirty ? <span className="dirty">Unsaved changes</span> : null}
          <Button
            onClick={onNext}
            disabled={nextDisabled || loading}
            variant={destructive ? "destructive" : "default"}
            type="button"
          >
            {loading ? "Working…" : nextLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
