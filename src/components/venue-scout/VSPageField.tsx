// Phase 5.12.14.1 Stage 2C: canonical Venue Scout page-form field primitive.
//
// Replaces 4 local `Field` helpers that drifted (NewScout + ScoutSettings
// were 13px; BriefEvent + BriefVenue were 12px). Canon: .label-form (grey
// 12px mono uppercase 0.06em tracking), optional required asterisk.
//
// Phase 5.12.14.3 Round 4 amendment v2 § A:
//   - `label` widened from `string` to `string | ReactNode` so callers can
//     pass composite labels (inline-right value suffix, embedded controls
//     like the BriefVenue Neighborhoods Strict? checkbox).
//   - Visual flipped from the per-field coral (text-primary) exception to
//     the canonical `.label-form` grey.
//
// R6 amendment v1 § 1: when `label` is a ReactNode (composite with nested
// controls like a Checkbox), render the wrapper as `<div>` instead of the
// shadcn `<Label>`. Native `<label>` forwards click semantics to its first
// labelable descendant — so a composite label that wraps a Radix Checkbox
// would route the click-on-label-text event to the Checkbox toggle. The
// `<div>` has no such forwarding; the inner Checkbox's own `<Label htmlFor>`
// preserves explicit single-association for the Checkbox itself.

import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";

export function VSPageField({
  label,
  required,
  children,
}: {
  label: string | ReactNode;
  required?: boolean;
  children: ReactNode;
}) {
  // String label = simple field; render with shadcn <Label> for a11y.
  // ReactNode label = composite (may contain controls); render with <div>
  // to avoid the nested-<label> HTML bug + label-click forwarding.
  const isComposite = typeof label !== "string";

  if (isComposite) {
    return (
      <div className="space-y-2">
        <div className="label-form block">
          {label}
          {required && <span className="ml-1 text-primary">*</span>}
        </div>
        {children}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Label className="label-form block">
        {label}
        {required && <span className="ml-1 text-primary">*</span>}
      </Label>
      {children}
    </div>
  );
}
