import { AdminsCard } from "@/components/settings/AdminsCard";
import { BulkImportCard } from "@/components/settings/BulkImportCard";
import {
  HQ_LOOKUPS,
  LookupListsCard,
} from "@/components/settings/LookupListsCard";
import { MirrorHolidaysEditor } from "@/components/settings/MirrorHolidaysEditor";

/**
 * Admin Settings page. Card-stack layout matching Wireframe Surface 20:
 *   1. Admins
 *   2. Lookup Lists (expandable inline editors per row; covers Project
 *      Categories + Cities + Venue Types + Vendor Capabilities +
 *      Vendor Categories + Departments)
 *   3. Mirror Holidays
 *   4. Integrations (collapsed Coming Soon stub; wiring lands with notification dispatch in a future phase)
 *
 * R7 amendment v1 § 6: Lookup Lists table extracted to
 * `src/components/settings/LookupListsCard.tsx` so VS Settings can
 * reuse the same chrome (filtered to its relevant lookup keys).
 */
export default function SettingsPage() {
  return (
    <div className="stack-6 hq-form" style={{ maxWidth: 980 }}>
      <div className="pagehead">
        <div className="eyebrow">Admin</div>
        <h1 className="h-page" style={{ marginTop: 4 }}>Settings</h1>
      </div>

      <AdminsCard />

      <LookupListsCard lookups={HQ_LOOKUPS} />

      <BulkImportCard />

      <div className="card">
        <div className="card-headbar">
          <span className="h-card">Integrations</span>
          <span className="muted" style={{ marginLeft: 8, fontSize: 12 }}>
            (Coming Soon)
          </span>
        </div>
      </div>

      <MirrorHolidaysEditor />
    </div>
  );
}
