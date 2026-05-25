// Phase 5.12.14.1 Stage 2C: unified app-wide back-crumb component.
// Drop-in replacement for inline `<Link className="crumb">` patterns across
// both Venue Scout and HQ Core pages. Consumes `useReferrerCrumb` for
// label + href; renders the canonical `<IconArrowLeft /> Back to {label}`
// content.
//
// Pass `fallback` to control the third-priority fallback (used when there
// is no `state.from` and no sessionStorage referrer). Omit `fallback` and
// the hook falls back to the canonical-parent table.

import { Link } from "react-router-dom";
import { IconArrowLeft } from "@/components/icons/HQIcons";
import { useReferrerCrumb } from "@/hooks/useReferrerCrumb";

export function ReferrerCrumb({
  className,
  fallback,
}: {
  className?: string;
  fallback?: { to: string; label: string };
}) {
  const { label, href } = useReferrerCrumb({ fallback });
  return (
    // R6 amendment v1 § 2: explicit space char dropped; `.crumb` is now
    // inline-flex with gap:6px, which handles icon → label spacing without
    // an in-flow break opportunity.
    <Link to={href} className={className ?? "crumb"}>
      <IconArrowLeft className="ic ic-sm" />
      {label}
    </Link>
  );
}
