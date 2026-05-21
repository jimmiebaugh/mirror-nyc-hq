import { Fragment, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AdminsCard } from "@/components/settings/AdminsCard";
import { BulkImportCard } from "@/components/settings/BulkImportCard";
import { LookupListEditor } from "@/components/settings/LookupListEditor";
import { MirrorHolidaysEditor } from "@/components/settings/MirrorHolidaysEditor";
import type { LookupTable } from "@/lib/hq/lookups";

type OtherLookup = {
  key: LookupTable;
  list: string;
  usedBy: string;
};

const OTHER_LOOKUPS: OtherLookup[] = [
  { key: "project_categories", list: "Project Categories", usedBy: "Projects database" },
  { key: "cities", list: "Cities", usedBy: "Projects, Vendors, Venues, Clients databases" },
  { key: "venue_types", list: "Venue Types", usedBy: "Venues database" },
  { key: "vendor_capabilities", list: "Vendor Capabilities", usedBy: "Vendors database" },
  { key: "vendor_categories", list: "Vendor Categories", usedBy: "Vendors database" },
  { key: "departments", list: "Departments", usedBy: "Users database" },
];

/**
 * Admin Settings page. Card-stack layout matching Wireframe Surface 20:
 *   1. Admins
 *   2. Lookup Lists (expandable inline editors per row; covers Project
 *      Categories + Cities + Venue Types + Vendor Capabilities +
 *      Vendor Categories + Departments)
 *   3. Mirror Holidays
 *   4. Integrations (collapsed Coming Soon stub; wiring lands with notification dispatch in a future phase)
 */
export default function SettingsPage() {
  const [counts, setCounts] = useState<Record<LookupTable, number | null>>({
    cities: null,
    project_categories: null,
    vendor_capabilities: null,
    vendor_categories: null,
    venue_types: null,
    departments: null,
  });
  const [expanded, setExpanded] = useState<LookupTable | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const tables: LookupTable[] = [
        "cities",
        "project_categories",
        "vendor_capabilities",
        "vendor_categories",
        "venue_types",
        "departments",
      ];
      const next: Record<LookupTable, number | null> = { ...counts };
      await Promise.all(
        tables.map(async (t) => {
          const { count } = await supabase
            .from(t)
            .select("id", { count: "exact", head: true });
          next[t] = count ?? 0;
        }),
      );
      if (active) setCounts(next);
    })();
    return () => {
      active = false;
    };
    // counts in the dep array would re-run forever; we only refetch on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="stack-6 hq-form" style={{ maxWidth: 980 }}>
      <div className="pagehead">
        <div className="eyebrow">Admin</div>
        <h1 className="h-page" style={{ marginTop: 4 }}>Settings</h1>
      </div>

      <AdminsCard />

      <div className="card">
        <div className="card-headbar">
          <span className="h-card">Lookup Lists</span>
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
              {OTHER_LOOKUPS.map((l) => (
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
                      <td colSpan={4} style={{ background: "hsl(var(--surface))", padding: 0 }}>
                        <LookupListEditor table={l.key} layout="tags" />
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <BulkImportCard />

      <div className="card">
        <div className="card-headbar">
          <span className="h-card">Integrations</span>
          <span className="muted" style={{ marginLeft: 8, fontSize: 12 }}>
            — Coming Soon
          </span>
        </div>
      </div>

      <MirrorHolidaysEditor />
    </div>
  );
}
