import type { ReactNode } from "react";

export function HQFormField({
  label, required, hint, children,
}: {
  label: string | ReactNode;
  required?: boolean;
  hint?: string;
  children: ReactNode;
}) {
  const isComposite = typeof label !== "string";

  return (
    <div className="field">
      {isComposite ? (
        <div className="label-form">
          {label}
          {required ? <span className="req">*</span> : null}
        </div>
      ) : (
        <label className="label-form">
          {label}
          {required ? <span className="req">*</span> : null}
        </label>
      )}
      {hint ? <span className="hint">{hint}</span> : null}
      {children}
    </div>
  );
}
