import { Link } from "react-router-dom";
import { Download } from "lucide-react";

/**
 * Settings card surface for Bulk Import (Phase 5.9.1). Slots between the
 * Lookup Lists card and the Integrations card on SettingsPage. Three
 * entity buttons + a History button. As of 5.9.5 all four are enabled
 * (the per-entity importers shipped in 5.9.2 / .3 / .4; History links to
 * the audit page).
 *
 * Uses wireframe-canonical class names (`card`, `card-headbar`, `h-card`,
 * `card-pad`, `btn`, `btn-secondary`, `muted`, `tlink`) rather than parallel
 * Tailwind utilities, per design-system § 11.
 */

type EntityButton = {
  key: "project" | "vendor" | "venue";
  label: string;
  pendingPhase: string;
  enabled: boolean;
  /**
   * Phase 6.5 (IMPORT-TPL): public asset under /templates for the up-front
   * "Download template (CSV)" grab. Matches the entity config's
   * `templateFilename` (src/lib/hq/bulkImport/entities/*.ts) and the per-step
   * link in UploadStep.
   */
  templateFile: string;
};

const ENTITY_BUTTONS: EntityButton[] = [
  { key: "project", label: "Projects", pendingPhase: "5.9.2", enabled: true, templateFile: "bulk-import-projects-template.csv" },
  { key: "vendor", label: "Vendors", pendingPhase: "5.9.3", enabled: true, templateFile: "bulk-import-vendors-template.csv" },
  { key: "venue", label: "Venues", pendingPhase: "5.9.4", enabled: true, templateFile: "bulk-import-venues-template.csv" },
];

export function BulkImportCard() {
  return (
    <div className="card">
      <div className="card-headbar">
        <span className="h-card">Bulk Import</span>
      </div>
      <div className="card-pad" style={{ padding: 24 }}>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {ENTITY_BUTTONS.map((b) => (
            // Pass the entity key under a non-reserved prop name. React
            // consumes `key` itself, so a `{...b}`-spread `key` never reaches
            // the component (the link would point at /bulk-import/undefined).
            <EntityImportButton
              key={b.key}
              entityKey={b.key}
              label={b.label}
              pendingPhase={b.pendingPhase}
              enabled={b.enabled}
            />
          ))}
          <HistoryButton />
        </div>
        {/* Phase 6.5 (IMPORT-TPL): up-front template grabs, stacked under a
            Templates subheader. Mirrors VS Overview + the UploadStep link. */}
        <div className="label-section" style={{ marginTop: 20, marginBottom: 10 }}>
          Templates
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-start",
            gap: 8,
          }}
        >
          {ENTITY_BUTTONS.map((b) => (
            <a
              key={b.key}
              href={`/templates/${b.templateFile}`}
              download
              className="tlink"
            >
              <Download className="h-4 w-4" />
              {b.label} template (CSV)
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}

function EntityImportButton({
  entityKey,
  label,
  pendingPhase,
  enabled,
}: {
  entityKey: EntityButton["key"];
  label: string;
  pendingPhase: string;
  enabled: boolean;
}) {
  const tooltip = enabled ? undefined : `Coming in Phase ${pendingPhase}`;
  if (enabled) {
    return (
      <Link
        to={`/settings/bulk-import/${entityKey}`}
        className="btn btn-secondary"
      >
        {label}
      </Link>
    );
  }
  return (
    <button
      type="button"
      className="btn btn-secondary"
      disabled
      title={tooltip}
      style={{ opacity: 0.55, cursor: "not-allowed" }}
    >
      {label}
    </button>
  );
}

function HistoryButton() {
  return (
    <Link
      to="/settings/bulk-import/history"
      className="btn btn-secondary"
      style={{ marginLeft: "auto" }}
    >
      History
    </Link>
  );
}
