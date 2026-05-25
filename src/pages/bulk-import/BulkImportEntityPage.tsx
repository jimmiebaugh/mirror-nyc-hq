import { useParams } from "react-router-dom";
import { BulkImportPage } from "@/components/bulk-import/BulkImportPage";
import { getEntityConfig } from "@/lib/hq/bulkImport/registry";
// Side-effect import: registers every shipped entity config at module load.
import "@/lib/hq/bulkImport/entities";

const PENDING_PHASES: Record<string, string> = {
  vendor: "5.9.3",
  venue: "5.9.4",
};

const PRETTY_LABELS: Record<string, string> = {
  project: "Projects",
  vendor: "Vendors",
  venue: "Venues",
};

export default function BulkImportEntityPage() {
  const { entity } = useParams<{ entity: string }>();
  const key = (entity ?? "").toLowerCase();
  const config = getEntityConfig(key);

  if (!config) {
    const pretty = PRETTY_LABELS[key];
    const pending = PENDING_PHASES[key];

    if (!pretty || !pending) {
      return (
        <div className="mx-auto max-w-3xl space-y-6 px-6 py-8">
          {/* R7 amendment v3 § 3: per-page back-crumb retired; TopBar carries it. */}
          <h1 className="h-page">Bulk Import</h1>
          <div className="rounded-md border border-dashed border-border py-12 text-center">
            <p className="text-sm text-muted-foreground">
              Unknown importer: {entity}
            </p>
          </div>
        </div>
      );
    }

    return (
      <div className="mx-auto max-w-3xl space-y-6 px-6 py-8">
        <header className="space-y-2">
          {/* R7 amendment v3 § 3: per-page back-crumb retired; TopBar carries it. */}
          <h1 className="h-page">Bulk Import · {pretty}</h1>
        </header>
        <div className="rounded-md border border-dashed border-border py-12 text-center">
          <p className="text-sm text-muted-foreground">
            The {pretty} importer ships in Phase {pending}.
          </p>
        </div>
      </div>
    );
  }

  return (
    <BulkImportPage
      config={config}
      resolveUnresolved={config.buildUnresolved}
      resolveDedupe={config.buildDedupe}
    />
  );
}
