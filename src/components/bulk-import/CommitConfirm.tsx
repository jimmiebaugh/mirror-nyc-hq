import type { EntityConfig } from "@/lib/hq/bulkImport/types";

export type CommitSummary = {
  rowsToCreate: number;
  rowsToUpdate: number;
  rowsToSkip: number;
  createdRefsByKind: Record<string, number>;
  hasValidationErrors: boolean;
};

export function CommitConfirm({
  config,
  summary,
}: {
  config: EntityConfig;
  summary: CommitSummary;
}) {
  const newRefsTotal = Object.values(summary.createdRefsByKind).reduce(
    (sum, n) => sum + n,
    0,
  );
  const refBreakdown = Object.entries(summary.createdRefsByKind)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${n} new ${k}${n === 1 ? "" : "s"}`)
    .join(", ");

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-border bg-surface-alt p-6">
        <h2 className="h-card mb-3">Ready to import</h2>
        <ul className="space-y-2 text-sm">
          <li>
            <span className="font-semibold">{summary.rowsToCreate}</span>{" "}
            {config.displayName} will be created.
          </li>
          {summary.rowsToUpdate > 0 ? (
            <li>
              <span className="font-semibold">{summary.rowsToUpdate}</span> existing record
              {summary.rowsToUpdate === 1 ? "" : "s"} will be updated.
            </li>
          ) : null}
          {newRefsTotal > 0 ? (
            <li>
              <span className="font-semibold">{newRefsTotal}</span> new reference
              {newRefsTotal === 1 ? "" : "s"} will be created in the same transaction
              {refBreakdown ? ` (${refBreakdown})` : null}.
            </li>
          ) : null}
          {summary.rowsToSkip > 0 ? (
            <li className="text-muted-foreground">
              {summary.rowsToSkip} row{summary.rowsToSkip === 1 ? "" : "s"} will be skipped as duplicate.
            </li>
          ) : null}
        </ul>

        {summary.hasValidationErrors ? (
          <p className="mt-4 rounded-md border border-destructive bg-destructive/10 p-3 text-xs text-destructive">
            Some rows still have validation errors. Continuing will import them anyway.
          </p>
        ) : null}
      </div>
    </div>
  );
}
