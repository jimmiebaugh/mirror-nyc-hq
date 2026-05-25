import type { ReactNode } from "react";

export function DField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="field">
      <div className="label-form">{label}</div>
      {children}
    </div>
  );
}
