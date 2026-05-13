// Compact label-above-input form field primitive.
//
// 10px uppercase muted-foreground label sitting tight above its child. Used
// for matrix-card layouts where many small fields stack and a heavier label
// would steal visual weight from the field values.
//
// Distinct from the page-form Field shape used in Brief / NewScout /
// NewRoleDetails (13px font-mono text-primary Label). Those pages keep their
// inline definitions for now; reconciliation isn't 4.7.1-port's job.
//
// Lifted from VS Pro src/pages/sourcing/Review.tsx's inline Field shape
// (Phase 4.7.1-port spec § 5 + decisions § 4).

import type { ReactNode } from "react";

export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground mb-1.5">
        {label}
      </div>
      {children}
    </div>
  );
}
