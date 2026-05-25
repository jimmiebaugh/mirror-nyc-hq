import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { supabase } from "@/integrations/supabase/client";

// Phase 5.12.7 Feature A: HQ Venue picker on SourcingReport.
//
// Producer-facing shape (post-smoke 2026-05-24): whole row is an amber
// button, matching the manually-add-venue row's full-row format but in
// the design system's amber (--warn) palette so the two affordances read
// as paired but distinct. Click opens a popover anchored to the row
// with a cmdk typeahead listing every HQ venue in the scout's city
// (case-insensitive equality on `city`; all-cities fallback when scout
// has no city). Pick fires onSelected; popover closes; another click
// reopens for the next pick.
//
// SELECT column list mirrors `loadHqVenuesIntoPool` in
// vs-research-venues/index.ts byte-for-byte (the venues table has NO
// `venue_type` column — venue type lives on the venue_venue_types join
// table — and NO `size_sq_ft` column; the canonical fields are
// total_sq_ft + square_footage). The picker caches the full payloads,
// looks them up on pick, and calls onSelected with the full record so
// the parent can build the vs_candidate_venues INSERT.
//
// existingLinkedVenueIds is read for display purposes today (reserved
// for a future "already in matrix" visual hint). The authoritative
// dedupe lives on the parent's onSelected handler, which runs a
// pre-INSERT SELECT against vs_candidate_venues.

type VenueTypesJoinRow = {
  venue_types: { name: string | null } | null;
};

export type HqVenueSelection = {
  id: string;
  name: string;
  address: string | null;
  neighborhood: string | null;
  city: string | null;
  venue_venue_types: VenueTypesJoinRow[] | null;
  total_sq_ft: number | null;
  square_footage: number | null;
  capacity: number | null;
  features: string[];
  website_url: string | null;
  about_venue: string | null;
};

type HqVenuePickerProps = {
  scoutId: string;
  scoutCity: string | null;
  existingLinkedVenueIds: Set<string>;
  onSelected: (venue: HqVenueSelection) => void | Promise<void>;
  /** Column span for the row's single <td>. SourcingReport currently runs 7 cols. */
  colSpan: number;
  disabled?: boolean;
};

export function HqVenuePicker({
  scoutCity,
  onSelected,
  colSpan,
  disabled = false,
}: HqVenuePickerProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [options, setOptions] = useState<
    { id: string; label: string; payload: HqVenueSelection }[]
  >([]);

  const cityForLoad = useMemo(
    () => (scoutCity ?? "").trim() || null,
    [scoutCity],
  );

  // Lazy-load the venue list the first time the popover opens for a
  // given city. Subsequent opens reuse the cached list within the same
  // session; if the producer changes scout city mid-session (unusual),
  // re-load on the next open.
  useEffect(() => {
    if (!open) return;
    if (hasLoaded) return;
    let active = true;
    setLoading(true);
    (async () => {
      let query = supabase
        .from("venues")
        .select(
          "id, name, address, neighborhood, city, website_url, features, total_sq_ft, square_footage, capacity, about_venue, venue_venue_types(venue_types(name))",
        )
        .order("name", { ascending: true });
      if (cityForLoad) query = query.ilike("city", cityForLoad);
      const { data, error } = await query;
      if (!active) return;
      if (error || !data) {
        setOptions([]);
      } else {
        const rows = data as unknown as HqVenueSelection[];
        setOptions(
          rows.map((r) => ({
            id: r.id,
            label: r.neighborhood ? `${r.name} · ${r.neighborhood}` : r.name,
            payload: r,
          })),
        );
      }
      setLoading(false);
      setHasLoaded(true);
    })();
    return () => {
      active = false;
    };
  }, [open, hasLoaded, cityForLoad]);

  // Reset cache when the city scope flips so a producer who happens to
  // edit the scout city sees fresh options on next open.
  useEffect(() => {
    setHasLoaded(false);
    setOptions([]);
  }, [cityForLoad]);

  const handlePick = useCallback(
    async (payload: HqVenueSelection) => {
      setOpen(false);
      await onSelected(payload);
    },
    [onSelected],
  );

  const buttonLabel = cityForLoad
    ? `Add ${cityForLoad} Venue from Venue Database`
    : `Add Venue from Venue Database`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <tr
          className={`border-t border-border bg-amber-400/5 hover:bg-amber-400/10 ${
            disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"
          }`}
          onClick={() => {
            if (disabled) return;
            setOpen((prev) => !prev);
          }}
          data-hq-picker-row
        >
          <td
            colSpan={colSpan}
            className="px-6 py-4 text-center text-amber-400 text-xs font-bold uppercase tracking-[0.14em]"
          >
            <span className="inline-flex items-center gap-2">
              <Plus className="h-3.5 w-3.5" /> {buttonLabel}
            </span>
          </td>
        </tr>
      </PopoverAnchor>
      <PopoverContent
        className="w-[320px] p-0"
        align="center"
        sideOffset={4}
      >
        <Command shouldFilter>
          <CommandInput placeholder="Search HQ Venues..." />
          <CommandList>
            {loading ? (
              <div className="py-3 text-center text-xs text-muted-foreground">
                Loading...
              </div>
            ) : (
              <CommandEmpty>
                {cityForLoad
                  ? `No HQ venues in ${cityForLoad}. Add one via /venues first.`
                  : `No HQ venues yet. Add one via /venues first.`}
              </CommandEmpty>
            )}
            {options.length > 0 ? (
              <CommandGroup>
                {options.map((opt) => (
                  <CommandItem
                    key={opt.id}
                    value={opt.label}
                    onSelect={() => handlePick(opt.payload)}
                    className="cursor-pointer"
                  >
                    <span className="flex-1 truncate">{opt.label}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
