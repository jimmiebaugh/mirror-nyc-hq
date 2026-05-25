import { useEffect, useMemo, useState } from "react";
import { IconPlus, IconX } from "@/components/icons/HQIcons";
import { invalidateLookup, useLookup } from "@/lib/hq/lookups";
import { supabase } from "@/integrations/supabase/client";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "@/hooks/use-toast";

/**
 * Phase 5.12.9: Settings card for the city-scoped Neighborhoods lookup.
 *
 * The parent-scoped layout doesn't fit the flat OTHER_LOOKUPS row table,
 * so it lives as a standalone card between the Lookup Lists card and the
 * Bulk Import card. Each city renders as a native <details> row with a
 * count chip; the per-city tag editor mounts lazily on first expand so we
 * don't spin up N useLookup subscribers up front.
 *
 * Counts come from a single top-level select("city_id") read grouped
 * client-side; the editor's own useLookup keeps the picker live, but the
 * count chip is a refetch-on-mount snapshot (refreshes the next time the
 * page mounts after an add/remove).
 */
/**
 * R7 amendment v2 § 3: `inline` mode drops the outer .card chrome so the
 * editor reads cleanly inside an expanded Lookup Lists table row (HQ
 * Settings + VS Settings consolidation). Default mode keeps the
 * standalone card chrome for any consumer that still mounts it as a
 * sibling card.
 */
export function NeighborhoodsLookupEditor({ inline = false }: { inline?: boolean } = {}) {
  const cities = useLookup("cities");
  const [expandedCityIds, setExpandedCityIds] = useState<Set<string>>(new Set());
  const [neighborhoodCountsByCity, setNeighborhoodCountsByCity] = useState<
    Record<string, number>
  >({});

  useEffect(() => {
    let active = true;
    (async () => {
      const { data, error } = await supabase
        .from("neighborhoods")
        .select("city_id");
      if (!active) return;
      if (error || !data) return;
      const counts: Record<string, number> = {};
      for (const row of data as { city_id: string }[]) {
        counts[row.city_id] = (counts[row.city_id] ?? 0) + 1;
      }
      setNeighborhoodCountsByCity(counts);
    })();
    return () => {
      active = false;
    };
  }, []);

  const sortedCities = useMemo(
    () => [...cities.options].sort((a, b) => a.name.localeCompare(b.name)),
    [cities.options],
  );

  const toggle = (cityId: string, open: boolean) => {
    setExpandedCityIds((prev) => {
      const next = new Set(prev);
      if (open) next.add(cityId);
      else next.delete(cityId);
      return next;
    });
  };

  // R7 amendment v2 § 3: body is the same regardless of inline mode; only
  // the outer card wrapper differs.
  const body = (
    <div className={inline ? "stack-3" : "card-pad stack-3"}>
      {sortedCities.length === 0 ? (
        <p className="cap">No cities yet. Add cities from the Cities row above.</p>
      ) : (
        sortedCities.map((city) => (
          <details
            key={city.id}
            className="rounded border border-border"
            onToggle={(e) =>
              toggle(city.id, (e.target as HTMLDetailsElement).open)
            }
          >
            <summary
              className="row between"
              style={{ padding: "10px 12px", cursor: "pointer" }}
            >
              <span style={{ fontSize: 13, fontWeight: 600 }}>{city.name}</span>
              <span className="muted mono" style={{ fontSize: 11 }}>
                {neighborhoodCountsByCity[city.id] ?? 0}
              </span>
            </summary>
            <div style={{ padding: "0 12px 12px" }}>
              {expandedCityIds.has(city.id) ? (
                <CityNeighborhoodEditor cityId={city.id} />
              ) : null}
            </div>
          </details>
        ))
      )}
    </div>
  );

  if (inline) {
    return <div style={{ padding: 16 }}>{body}</div>;
  }

  return (
    <div className="card">
      <div className="card-headbar">
        <span className="h-card">Neighborhoods</span>
        <span className="muted" style={{ marginLeft: 8, fontSize: 12 }}>
          Nested under cities
        </span>
      </div>
      {body}
    </div>
  );
}

function CityNeighborhoodEditor({ cityId }: { cityId: string }) {
  const { options, addOption } = useLookup("neighborhoods", {
    parentScopeId: cityId,
  });
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<
    { id: string; name: string } | null
  >(null);
  const [optimisticDeletes, setOptimisticDeletes] = useState<Set<string>>(
    new Set(),
  );

  const visible = options.filter((o) => !optimisticDeletes.has(o.id));

  const commitAdd = async () => {
    const trimmed = newName.trim();
    if (!trimmed) {
      setAdding(false);
      return;
    }
    const result = await addOption(trimmed);
    if (!result) {
      toast({
        title: "Add failed",
        description: "Name may already exist for this city",
        variant: "destructive",
      });
    } else {
      toast({ title: `Added "${trimmed}"` });
    }
    setNewName("");
    setAdding(false);
  };

  const doDelete = async () => {
    if (!confirmDelete) return;
    const { id, name } = confirmDelete;
    setConfirmDelete(null);
    setOptimisticDeletes((prev) => new Set(prev).add(id));
    const { error } = await supabase
      .from("neighborhoods")
      .delete()
      .eq("id", id);
    if (error) {
      setOptimisticDeletes((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      toast({
        title: "Delete failed",
        description: error.message,
        variant: "destructive",
      });
      return;
    }
    // Phase 5.12.9: invalidate the shared lookup cache for this city
    // scope so every other mounted RecordCombobox (VenueEdit, BriefVenue,
    // matrix cells, etc.) re-fetches without the deleted row. The
    // module-level cache otherwise never refetches once populated, so
    // sibling consumers would keep showing the deleted neighborhood
    // until a full page reload. Live useLookup subscribers refetch
    // immediately; dormant entries refetch on next mount.
    invalidateLookup("neighborhoods", cityId);
    toast({ title: `Removed "${name}"` });
  };

  return (
    <>
      <div className="row wrap" style={{ gap: 7, alignItems: "center", paddingTop: 8 }}>
        {visible.length === 0 ? (
          <span
            className="tag"
            style={{ borderStyle: "dashed", color: "hsl(var(--subtle-foreground))" }}
          >
            No items yet
          </span>
        ) : null}
        {visible.map((o) => (
          <span
            key={o.id}
            className="tag"
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            {o.name}
            <button
              type="button"
              className="ca"
              onClick={() => setConfirmDelete({ id: o.id, name: o.name })}
              title="Delete"
              aria-label={`Delete ${o.name}`}
              style={{ marginLeft: 2 }}
            >
              <IconX className="ic" style={{ width: 9, height: 9 }} />
            </button>
          </span>
        ))}
        {adding ? (
          <input
            autoFocus
            className="input"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onBlur={commitAdd}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitAdd();
              if (e.key === "Escape") {
                setNewName("");
                setAdding(false);
              }
            }}
            placeholder="New neighborhood..."
            style={{ width: 200, height: 30 }}
          />
        ) : (
          <button
            type="button"
            className="tlink"
            onClick={() => setAdding(true)}
            style={{ background: "none", border: "none" }}
          >
            <IconPlus className="ic ic-sm" />
            Add
          </button>
        )}
      </div>

      <AlertDialog
        open={Boolean(confirmDelete)}
        onOpenChange={(open) => !open && setConfirmDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove "{confirmDelete?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This deletes the neighborhood from the lookup list. Existing
              records that reference it may need to be updated by hand.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={doDelete}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
