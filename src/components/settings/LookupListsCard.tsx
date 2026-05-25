// Phase 5.12.14.3 R7 amendment v1 § 6: shared Lookup Lists card.
//
// Extracted from `src/pages/settings/SettingsPage.tsx` so both HQ Settings
// + VS Settings (and any future consumer) render the same table-of-lists
// chrome (LIST | USED BY | VALUES | Edit) with inline-expansion editor.
//
// HQ Settings consumes all six default lookups. VS Settings filters via
// the `lookups` prop to the subset relevant to the Venue Scout module
// (cities + venue_types). Neighborhoods is a parent-scoped lookup; it
// renders via the separate `NeighborhoodsLookupEditor` component in
// whichever page wants it (HQ Settings + VS Settings both mount it as a
// sibling card).

import { Fragment, useEffect, useState } from "react";
import { LookupListEditor } from "@/components/settings/LookupListEditor";
import { NeighborhoodsLookupEditor } from "@/components/settings/NeighborhoodsLookupEditor";
import { supabase } from "@/integrations/supabase/client";
import type { LookupTable } from "@/lib/hq/lookups";

export type LookupListsCardEntry = {
  key: LookupTable;
  list: string;
  usedBy: string;
};

// HQ Settings default set. Re-exported so the page-level shipping list
// keeps the same shape; VS Settings can filter or roll its own subset.
// R7 amendment v2 § 3: Neighborhoods promoted into the shared table
// (was a standalone card on both Settings pages). Expansion content
// branches in the row renderer below — NeighborhoodsLookupEditor for
// neighborhoods (city-scoped editor), LookupListEditor for everything
// else.
export const HQ_LOOKUPS: LookupListsCardEntry[] = [
  {
    key: "project_categories",
    list: "Project Categories",
    usedBy: "Projects database",
  },
  {
    key: "cities",
    list: "Cities",
    usedBy: "Projects, Vendors, Venues, Clients databases",
  },
  {
    key: "neighborhoods",
    list: "Neighborhoods",
    usedBy: "Venues database (scoped by city)",
  },
  { key: "venue_types", list: "Venue Types", usedBy: "Venues database" },
  {
    key: "vendor_capabilities",
    list: "Vendor Capabilities",
    usedBy: "Vendors database",
  },
  {
    key: "vendor_categories",
    list: "Vendor Categories",
    usedBy: "Vendors database",
  },
  { key: "departments", list: "Departments", usedBy: "Users database" },
];

export type LookupListsCardProps = {
  /** Card title — HQ Settings uses "Lookup Lists"; VS Settings overrides. */
  title?: string;
  /** Filter set. Caller picks which lookups to render. */
  lookups: LookupListsCardEntry[];
};

export function LookupListsCard({
  title = "Lookup Lists",
  lookups,
}: LookupListsCardProps) {
  const [counts, setCounts] = useState<Partial<Record<LookupTable, number>>>(
    {},
  );
  const [expanded, setExpanded] = useState<LookupTable | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const next: Partial<Record<LookupTable, number>> = {};
      await Promise.all(
        lookups.map(async (l) => {
          const { count } = await supabase
            .from(l.key)
            .select("id", { count: "exact", head: true });
          next[l.key] = count ?? 0;
        }),
      );
      if (active) setCounts(next);
    })();
    return () => {
      active = false;
    };
    // Only refetch when the consumer-supplied list shape changes (which is
    // usually a stable module-level constant). Counts are a mount snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lookups]);

  return (
    <div className="card">
      <div className="card-headbar">
        <span className="h-card">{title}</span>
      </div>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th>List</th>
              <th>Used by</th>
              <th className="r">Values</th>
              <th className="r" style={{ width: 60 }}></th>
            </tr>
          </thead>
          <tbody>
            {lookups.map((l) => (
              <Fragment key={l.key}>
                <tr>
                  <td className="lead">{l.list}</td>
                  <td className="muted">{l.usedBy}</td>
                  <td className="r muted">{counts[l.key] ?? "..."}</td>
                  <td className="r">
                    <button
                      type="button"
                      className="tlink"
                      style={{ background: "none", border: "none" }}
                      onClick={() =>
                        setExpanded((cur) => (cur === l.key ? null : l.key))
                      }
                    >
                      {expanded === l.key ? "Close" : "Edit"}
                    </button>
                  </td>
                </tr>
                {expanded === l.key ? (
                  <tr>
                    <td
                      colSpan={4}
                      style={{
                        background: "hsl(var(--surface))",
                        padding: 0,
                      }}
                    >
                      {/* R7 amendment v2 § 3: branch on key — neighborhoods
                          gets the parent-scoped city editor; everything
                          else uses the flat LookupListEditor. */}
                      {l.key === "neighborhoods" ? (
                        <NeighborhoodsLookupEditor inline />
                      ) : (
                        <LookupListEditor table={l.key} layout="tags" />
                      )}
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
