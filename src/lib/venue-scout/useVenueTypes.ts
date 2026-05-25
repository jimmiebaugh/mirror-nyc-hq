import { useLookup } from "@/lib/hq/lookups";
import { TYPE_STYLES, TYPE_FALLBACK_STYLE } from "./venueTypes";

/**
 * Phase 5.12.10: runtime canonical venue-types list. Reads
 * `public.venue_types` via the shared `useLookup` cache so producer
 * adds in HQ Settings flow through automatically.
 *
 * Returns `names` (string[], sorted by name asc per useLookup
 * contract) and `paletteFor(name)` (the rgba palette class for known
 * legacy palette keys, falling back to TYPE_FALLBACK_STYLE for novel
 * types). `loading` mirrors useLookup's loading flag for the initial
 * load.
 *
 * Caching: module-level subscriber cache from `useLookup`. Producer
 * adds via `addOption` (Settings or inline-add elsewhere) update the
 * cache immediately; producer DELETEs via Settings hit the
 * LookupListEditor cache-staleness bug per
 * feedback_lookup_editor_cache_staleness (not fixed in 5.12.10; pre-
 * existing, sibling consumers go stale until a full reload).
 */
export function useVenueTypes() {
  const { options, loading } = useLookup("venue_types");
  const names = options.map((o) => o.name);
  const paletteFor = (name: string): string =>
    (TYPE_STYLES as Record<string, string | undefined>)[name] ??
    TYPE_FALLBACK_STYLE;
  return { names, paletteFor, loading };
}
