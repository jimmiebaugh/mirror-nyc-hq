import { IconArrowLeft } from "@/components/icons/HQIcons";

/**
 * Sticky bottom action bar for the bulk-import wizard. Wraps the design-
 * system § 3 sticky-bar pattern with Next semantics tuned for the 5-step
 * wizard. The `dirty` indicator surfaces when there are unsaved edits in the
 * active step.
 *
 * Phase 6.5 follow-up: 3-zone layout. Back (step navigation, with the back-
 * arrow) sits far left; Cancel (discard/exit, NO arrow -- the arrow is reserved
 * for navigation) is centered; the Next/dirty cluster sits far right. The
 * stepper is a non-clickable progress indicator, so the wizard keeps an
 * explicit Back for step-back nav alongside Cancel.
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
      <div className="mx-auto grid max-w-7xl grid-cols-[1fr_auto_1fr] items-center gap-3 px-6 py-4">
        <div className="justify-self-start">
          {onBack ? (
            <button
              type="button"
              className="btn btn-tertiary"
              onClick={onBack}
              disabled={backDisabled || loading}
            >
              <IconArrowLeft className="ic" />
              Back
            </button>
          ) : null}
        </div>
        <div className="justify-self-center">
          {onCancel ? (
            <button
              type="button"
              className="btn btn-tertiary"
              onClick={onCancel}
              disabled={loading}
            >
              Cancel
            </button>
          ) : null}
        </div>
        <div className="flex items-center justify-self-end gap-3">
          {dirty ? <span className="dirty">Unsaved changes</span> : null}
          <button
            type="button"
            className={`btn ${destructive ? "btn-danger" : "btn-primary"}`}
            onClick={onNext}
            disabled={nextDisabled || loading}
          >
            {loading ? "Working…" : nextLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
