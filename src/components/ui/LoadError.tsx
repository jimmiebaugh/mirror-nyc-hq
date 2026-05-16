import { IconAlert } from "@/components/icons/HQIcons";

/**
 * Phase 5.5 shared load-error component (spec § 7).
 *
 * Wireframe binding: OUTPUTS/phase-5-hq-wireframe-v1-LOCKED.html lines 3528-3535
 * (Surface 23 "Load error" variant). Renders the `.empty` block with the
 * destructive alert icon, a foreground-weight title, a muted description,
 * and a Retry button. Pair with React-Query refetch or your own loader's
 * retry path.
 */

export function LoadError({
  title = "Something went wrong",
  description,
  onRetry,
  retryLabel = "Retry",
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  return (
    <div className="empty">
      <IconAlert
        className="ic"
        style={{
          width: 28,
          height: 28,
          margin: "0 auto 8px",
          color: "hsl(var(--destructive))",
        }}
      />
      <p style={{ color: "hsl(var(--foreground))", fontWeight: 500 }}>{title}</p>
      {description ? <p style={{ marginTop: 4 }}>{description}</p> : null}
      {onRetry ? (
        <button
          type="button"
          className="btn btn-secondary"
          style={{ marginTop: 14 }}
          onClick={onRetry}
        >
          {retryLabel}
        </button>
      ) : null}
    </div>
  );
}
