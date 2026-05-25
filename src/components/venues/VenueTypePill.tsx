import {
  TYPE_STYLES,
  TYPE_FALLBACK_STYLE,
  canonicalizeType,
  type CanonicalType,
} from "@/lib/venue-scout/venueTypes";

/**
 * Colored venue-type pill. Shared across VenuesList / VenueEdit / VenueDetail
 * (was three drifting per-file copies before the Phase 5.10.1 dedupe).
 * `small` renders the compact `pill-sm` variant used in dense list/table rows;
 * `large` renders the `pill-lg` variant used in the VenueDetail caption row so
 * the type pills match the Vendor Internal pill size (Phase 5.11.1).
 */
export function VenueTypePill({
  type,
  small,
  large,
}: {
  type: string;
  small?: boolean;
  large?: boolean;
}) {
  const canonical = canonicalizeType(type) as CanonicalType | null;
  const style = canonical ? TYPE_STYLES[canonical] : TYPE_FALLBACK_STYLE;
  return (
    <span
      className={["pill", small && "pill-sm", large && "pill-lg", style]
        .filter(Boolean)
        .join(" ")}
      style={{ borderWidth: 1, borderStyle: "solid" }}
    >
      {type}
    </span>
  );
}
