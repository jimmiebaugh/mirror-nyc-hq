// Phase 5.12.14: shared matrix row primitive. Sourcing + Shortlist both
// render through this component; per-page differences collapse to the col-1
// label (Shortlist vs Pitch) + the page-level source-of-truth checkbox
// (`shortlisted` vs `pitched`).
//
// Column shape (6 cols, 1100px floor; Stage 2A restructure):
//   1. col-1 (110px): stacked checkbox top + SourcePill bottom
//   2. Venue (240px, sticky): name / neighborhood / address / divider /
//      type pills, centered both axes
//   3. Website (130px): WebsiteActionButton + coral pencil edit popover
//   4. Features (130px): compact TagInput, single-chip-wide vertical stack
//   5. Recommendations (245px): Bullets
//   6. Considerations (245px): Bullets
import { useEffect, useState } from "react";
import { IconPencil } from "@/components/icons/HQIcons";
import { WebsiteActionButton } from "@/components/hq/WebsiteActionButton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { RecordCombobox } from "@/components/ui/RecordCombobox";
import {
  Bullets,
  EditableField,
  SourcePill,
  Td,
  TypeTogglePopover,
} from "@/components/venue-scout/matrix/primitives";
import { TagInput } from "@/components/venue-scout/TagInput";
import { parseTypes } from "@/lib/venue-scout/venueTypes";
import { prettyHost } from "@/lib/url";

export type VenueMatrixRowVenue = {
  id: string;
  name: string;
  neighborhood: string | null;
  address: string | null;
  venue_type: string | null;
  key_features: string[] | null;
  website_url: string | null;
  recommendations: string[] | null;
  considerations: string[] | null;
  source: string | null;
};

export type VenueMatrixRowProps = {
  venue: VenueMatrixRowVenue;
  col1: {
    label: "Shortlist" | "Pitch";
    value: boolean;
    onToggle: (next: boolean) => void;
  };
  onNameChange: (next: string) => void;
  onAddressChange: (next: string | null) => void;
  // Website save is async. The parent persists immediately (no debounce on
  // this field) and awaits the supabase response so WebsiteCell can surface
  // failure via toast + keep the edit popover open on error.
  onWebsiteSave: (next: string) => Promise<void>;
  onNeighborhoodChange: (next: string | null) => void;
  onTypesChange: (next: string[]) => void;
  onFeaturesChange: (next: string[]) => void;
  scoutCityId: string | null;
  scoutCityName: string | null;
  availableTypes: string[];
  autoFocusName?: boolean;
};

export function VenueMatrixRow({
  venue,
  col1,
  onNameChange,
  onAddressChange,
  onWebsiteSave,
  onNeighborhoodChange,
  onTypesChange,
  onFeaturesChange,
  scoutCityId,
  scoutCityName,
  availableTypes,
  autoFocusName,
}: VenueMatrixRowProps) {
  const types = parseTypes(venue.venue_type, availableTypes);
  return (
    <tr
      className="group border-t border-border hover:bg-[rgba(255,255,255,0.025)] [&>td]:border-r [&>td]:border-border [&>td:last-child]:border-r-0"
      style={{ height: 1 }}
    >
      <Td vCenter noPadX sticky="col1" className="relative text-center">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
          <input
            type="checkbox"
            checked={col1.value}
            onChange={(e) => col1.onToggle(e.target.checked)}
            aria-label={col1.label}
            className="h-[18px] w-[18px] accent-[hsl(var(--primary))] cursor-pointer"
          />
        </div>
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 mt-[33px]">
          <SourcePill source={venue.source} />
        </div>
      </Td>
      <Td noPadX noPadY sticky="col2">
        {/*
          Outer flex column handles vertical centering + cell padding. Inner
          wrapper is shrink-to-fit (w-fit) capped at 225px so the stack's
          horizontal width tracks the widest content (venue title or
          neighborhood). Divider + address + type pills all inherit this width
          via w-full / max-w-full, so they're never wider than the
          title-or-neighborhood line above and never exceed 225px absolute.
        */}
        <div className="h-full flex flex-col items-center justify-center px-3 pt-16 pb-9">
          <div className="w-fit max-w-[225px] flex flex-col items-center text-center gap-1.5">
            <EditableField
              id={`${venue.id}-name`}
              value={venue.name}
              onChange={onNameChange}
              variant="name"
              placeholder="Venue name"
              autoFocusOnMount={autoFocusName}
            />
            <div className="mt-2 mb-[-1px] h-px w-full bg-border" />
            {/*
              Override the combobox-trigger's inner text span to text-center +
              pad-left equal to the chevron's right-side footprint (24px = 16px
              icon + 8px ml). That offsets the chevron so the rendered text
              visually centers in the cell column rather than skewing left.
              Font-size stays at the global combobox-trigger default (15px) so
              the neighborhood matches the rest of HQ's combobox surfaces.
            */}
            <div className="w-full [&_button>span.flex-1]:text-center [&_button>span.flex-1]:pl-6">
              <RecordCombobox
                source={{
                  kind: "lookup",
                  table: "neighborhoods",
                  parentScopeId: scoutCityId,
                  parentScopeLabel: scoutCityName,
                  parentScopeLabelKey: "City",
                }}
                value={venue.neighborhood || null}
                onChange={(next) => onNeighborhoodChange(next || null)}
                entityLabel="neighborhood"
                placeholder={scoutCityId ? "(neighborhood)" : "(pick scout city)"}
                disabled={!scoutCityId}
              />
            </div>
            <EditableField
              id={`${venue.id}-addr`}
              value={venue.address ?? ""}
              onChange={(a) => onAddressChange(a.trim() || null)}
              variant="address"
              placeholder="(no address)"
            />
            {/*
              [&_button]:w-full makes the TypeTogglePopover trigger button span
              the wrapper width so its inner `justify-center` actually centers
              pills when they fit in a single row. Default button width is
              content-fit; without this the row-of-pills hugs the left edge.
              PopoverContent is portaled by Radix so popover-item buttons aren't
              affected by this descendant selector.
            */}
            <div className="mt-7 w-full [&_button]:w-full">
              <TypeTogglePopover
                currentTypes={types}
                onChange={onTypesChange}
                direction="horizontal"
              />
            </div>
          </div>
        </div>
      </Td>
      <Td vCenter className="relative">
        <WebsiteCell value={venue.website_url} onSave={onWebsiteSave} />
      </Td>
      <Td vCenter>
        <TagInput
          compact
          value={venue.key_features ?? []}
          onChange={onFeaturesChange}
        />
      </Td>
      <Td vCenter>
        <Bullets items={venue.recommendations ?? []} />
      </Td>
      <Td vCenter>
        <Bullets items={venue.considerations ?? []} />
      </Td>
    </tr>
  );
}

function WebsiteCell({
  value,
  onSave,
}: {
  value: string | null;
  onSave: (next: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) setDraft(value ?? "");
  }, [value, open]);

  const submit = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await onSave(draft.trim());
      setOpen(false);
    } catch {
      // onSave's caller surfaces failure via toast; keep popover open.
    } finally {
      setSaving(false);
    }
  };

  // Parent Td is position:relative; anchor the WebsiteActionButton to the cell
  // vertical center via absolute positioning, then hang the pencil-edit popover
  // below it. When no URL exists, only the pencil renders, centered.
  const pencilClassName = value
    ? "absolute top-1/2 left-1/2 -translate-x-1/2 mt-6 inline-flex h-7 w-7 items-center justify-center rounded text-primary hover:bg-primary/10 transition-colors"
    : "absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 inline-flex h-7 w-7 items-center justify-center rounded text-primary hover:bg-primary/10 transition-colors";

  return (
    <>
      {value ? (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
          <WebsiteActionButton url={value} />
        </div>
      ) : null}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={value ? "Edit website" : "Add website"}
            className={pencilClassName}
            onClick={(e) => e.stopPropagation()}
          >
            <IconPencil className="h-4 w-4" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-3" align="end" onClick={(e) => e.stopPropagation()}>
          <label className="label-form mb-1.5 block">Website URL</label>
          <input
            type="url"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void submit();
              } else if (e.key === "Escape") {
                setOpen(false);
              }
            }}
            placeholder="https://example.com"
            className="input w-full"
            autoFocus
          />
          {value ? (
            <div className="mt-1 text-xs text-muted-foreground">
              Current: <span className="font-mono">{prettyHost(value)}</span>
            </div>
          ) : null}
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setOpen(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-coral btn-sm"
              onClick={() => void submit()}
              disabled={saving}
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </PopoverContent>
      </Popover>
    </>
  );
}
