import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AdminsCard } from "@/components/settings/AdminsCard";
import { LookupListEditor } from "@/components/settings/LookupListEditor";
import { MirrorHolidaysEditor } from "@/components/settings/MirrorHolidaysEditor";
import type { LookupTable } from "@/lib/hq/lookups";

type OtherLookup = {
  key: LookupTable;
  list: string;
  usedBy: string;
};

const OTHER_LOOKUPS: OtherLookup[] = [
  { key: "venue_types", list: "Venue Types", usedBy: "Venues database" },
  { key: "vendor_capabilities", list: "Vendor Capabilities", usedBy: "Vendors database" },
  { key: "vendor_categories", list: "Vendor Categories", usedBy: "Vendors database" },
  { key: "departments", list: "Departments", usedBy: "Users database" },
];

/**
 * Admin Settings page. Card-stack layout matching Wireframe Surface 20:
 *   1. Admins
 *   2. Grid: Project Categories + Cities
 *   3. Other Lookup Lists (expandable inline editors per row)
 *   4. Mirror Holidays
 *   5. Integrations (display-only placeholder for 5.4)
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

      <div className="grid g2" style={{ alignItems: "start" }}>
        <div className="card">
          <div className="card-headbar">
            <span className="h-card">Project Categories</span>
          </div>
          <LookupListEditor table="project_categories" />
        </div>
        <div className="card">
          <div className="card-headbar">
            <span className="h-card">Cities</span>
          </div>
          <LookupListEditor table="cities" />
        </div>
      </div>

      <div className="card">
        <div className="card-headbar">
          <span className="h-card">Other Lookup Lists</span>
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
                <tr key={l.key}>
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
              ))}
              {expanded ? (
                <tr>
                  <td colSpan={4} style={{ background: "hsl(var(--surface))", padding: 0 }}>
                    <LookupListEditor table={expanded} layout="tags" />
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="card-headbar">
          <span className="h-card">Integrations</span>
        </div>
        <div className="card-pad stack-3">
          <IntegrationRow
            title="Google Calendar push"
            description="One-way push of Install / Live / Removal and Deliverable dates to the Mirror Master Calendar"
          />
          <IntegrationRow
            title="Slack DM notifications"
            description="Requires each user's Slack Handle and Slack User ID on their Users record"
            divider
          />
          <IntegrationRow
            title="Google Drive link integration"
            description="Drive stays the file source of truth. HQ stores folder URLs only."
            divider
          />
        </div>
      </div>
      <p className="cap" style={{ marginTop: -8 }}>
        Integration toggles are display-only in this release. Wiring lands alongside the notification dispatch system in a later phase.
      </p>

      <MirrorHolidaysEditor />
    </div>
  );
}

function IntegrationRow({
  title,
  description,
  divider,
}: {
  title: string;
  description: string;
  divider?: boolean;
}) {
  return (
    <div
      className="row-c between"
      style={
        divider
          ? { borderTop: "1px solid hsl(var(--border))", paddingTop: 12 }
          : undefined
      }
    >
      <div>
        <div style={{ fontSize: 13, fontWeight: 500 }}>{title}</div>
        <div className="cap">{description}</div>
      </div>
      <button
        type="button"
        className="toggle toggle--on"
        disabled
        aria-label={`${title} (display-only)`}
        title="Display-only for this release"
      />
    </div>
  );
}
