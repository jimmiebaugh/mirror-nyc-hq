import type { ComponentType, ReactNode, SVGProps } from "react";

/**
 * Phase 5.5 shared empty-state component (spec § 7).
 *
 * Wireframe binding: OUTPUTS/phase-5-hq-wireframe-v1-LOCKED.html lines 3440-3446
 * (Surface 23 empty-list pattern) and lines 3539-3546 (empty notifications
 * panel). Renders the canonical `.empty` block already defined in
 * src/index.css with an icon, copy, and optional action button. Use in place
 * of ad-hoc dashed-border divs across the HQ Core list pages so the visual
 * treatment stays consistent and is updated in one file.
 */

type IconComponent = ComponentType<SVGProps<SVGSVGElement> & { className?: string }>;

export function EmptyState({
  icon: Icon,
  children,
  action,
  iconSize = 30,
}: {
  icon: IconComponent;
  children: ReactNode;
  action?: { label: string; onClick: () => void };
  iconSize?: number;
}) {
  return (
    <div className="empty">
      <Icon
        className="ic"
        style={{
          width: iconSize,
          height: iconSize,
          margin: "0 auto 6px",
          color: "hsl(var(--subtle-foreground))",
        }}
      />
      <p>{children}</p>
      {action ? (
        <button type="button" className="btn btn-secondary" onClick={action.onClick}>
          {action.label}
        </button>
      ) : null}
    </div>
  );
}
