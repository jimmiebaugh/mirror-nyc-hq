import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { DataTable, type Column } from "@/components/data/DataTable";
import {
  FilterBar,
  emptyFilterState,
  type FilterFieldDef,
  type FilterState,
} from "@/components/data/FilterBar";
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
import { applyFilters } from "@/lib/hq/filterStateApply";
import { IconX } from "@/components/icons/HQIcons";
import { formatMediumDate } from "@/lib/hq/dates";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import {
  loadImportSessions,
  committedWithinUndoWindow,
  BULK_IMPORT_UNDO_WINDOW_DAYS,
  type ImportSessionRow,
} from "@/lib/hq/bulkImport/sessions";

/**
 * Phase 5.9.5 bulk-import audit page (AdminRoute; RLS restricts the read
 * to admins). Mirrors OutlookPage's two-column grid shell: a filterable
 * DataTable of committed import sessions on the left, a fixed-width
 * detail rail on the right when a row is selected. Read-only; no realtime,
 * no writes, no confirmation dialogs.
 */

const ENTITY_LABEL: Record<ImportSessionRow["entity_type"], string> = {
  project: "Project",
  vendor: "Vendor",
  venue: "Venue",
};

const ENTITY_PLURAL: Record<ImportSessionRow["entity_type"], string> = {
  project: "projects",
  vendor: "vendors",
  venue: "venues",
};

// Humanize a created_refs key for the detail rail (vendor_categories ->
// "Vendor categories", people -> "Contacts"). Generic fallback replaces
// underscores with spaces and capitalizes the first letter.
const REF_LABEL_OVERRIDES: Record<string, string> = {
  people: "Contacts",
};

function humanizeRefKey(key: string): string {
  if (REF_LABEL_OVERRIDES[key]) return REF_LABEL_OVERRIDES[key];
  const spaced = key.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function refSum(refs: Record<string, number>): number {
  return Object.values(refs).reduce((s, n) => s + (typeof n === "number" ? n : 0), 0);
}

// Phase 5.9.6 undo. The RPC returns this shape (via the edge function); the
// dialog body renders a sentence from it.
type UndoCounts = {
  entity_type: string;
  records: number;
  contacts: number;
  cascade: Record<string, number>;
};

// Human labels for the cascade keys the undo RPC reports. Generic fallback
// replaces underscores with spaces.
const CASCADE_LABELS: Record<string, string> = {
  deliverables: "deliverables",
  tasks: "tasks",
  project_account_managers: "account-manager links",
  project_designers: "designer links",
  project_members: "member links",
  project_venues: "venue links",
  project_vendors: "vendor links",
  vendor_files: "files",
  vendor_ratings: "ratings",
  venue_venue_types: "type links",
  venue_contact_people: "contact links",
};

function cascadeLabel(key: string): string {
  return CASCADE_LABELS[key] ?? key.replace(/_/g, " ");
}

// Build the AlertDialog body from the dry-run counts. Zero-count cascade keys
// are omitted for brevity; the contacts clause only shows when > 0.
function buildUndoDescription(counts: UndoCounts): string {
  const singular = ENTITY_LABEL[counts.entity_type as ImportSessionRow["entity_type"]]?.toLowerCase()
    ?? counts.entity_type;
  const plural = ENTITY_PLURAL[counts.entity_type as ImportSessionRow["entity_type"]] ?? `${singular}s`;
  const recordWord = counts.records === 1 ? singular : plural;

  const cascadeParts = Object.entries(counts.cascade)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${n} ${cascadeLabel(k)}`);

  let s = `This permanently deletes ${counts.records} ${recordWord}`;
  if (cascadeParts.length > 0) {
    s += `, and cascades: ${cascadeParts.join(", ")}`;
  }
  s += ".";
  if (counts.contacts > 0) {
    s += ` It also deletes ${counts.contacts} imported contact${counts.contacts === 1 ? "" : "s"}.`;
  }
  s += " Shared lookups (cities, categories) are kept. This cannot be reversed.";
  return s;
}

// Pull a server-provided error message out of a functions.invoke failure
// (mirrors the BulkImportPage commit path).
async function invokeErrorMessage(error: unknown, fallback: string): Promise<string> {
  const ctx = (error as { context?: Response })?.context;
  const baseMsg = (error as { message?: string })?.message ?? fallback;
  if (ctx && typeof ctx.json === "function") {
    try {
      const body = (await ctx.clone().json()) as { error?: string };
      if (body?.error) return body.error;
    } catch {
      /* swallow */
    }
  }
  return baseMsg;
}

const FILTER_FIELDS: FilterFieldDef[] = [
  {
    key: "entity_type",
    label: "Entity type",
    type: "enum",
    options: ["project", "vendor", "venue"],
  },
  { key: "actorName", label: "Actor", type: "lookup", lookupOptions: [] },
  { key: "committed_at", label: "Date", type: "date" },
];

export default function BulkImportHistoryPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<ImportSessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterState, setFilterState] = useState<FilterState>(emptyFilterState());
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    loadImportSessions()
      .then((r) => {
        if (active) setRows(r);
      })
      .catch(() => {
        if (active) {
          toast({
            title: "Couldn't load import history",
            variant: "destructive",
          });
          setRows([]);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  // Actor lookup options built from the distinct actor display names in the
  // loaded set. Filtering matches the display-name string (getField below).
  const fields = useMemo<FilterFieldDef[]>(() => {
    const names = Array.from(new Set(rows.map((r) => r.actor_name))).sort();
    return FILTER_FIELDS.map((f) =>
      f.key === "actorName"
        ? { ...f, lookupOptions: names.map((n) => ({ id: n, name: n })) }
        : f,
    );
  }, [rows]);

  const filtered = useMemo(
    () =>
      applyFilters(rows, filterState, (row, key) => {
        if (key === "entity_type") return row.entity_type;
        if (key === "actorName") return row.actor_name;
        if (key === "committed_at") return row.committed_at;
        return null;
      }),
    [rows, filterState],
  );

  const selected = useMemo(
    () => rows.find((r) => r.id === selectedId) ?? null,
    [rows, selectedId],
  );

  const columns: Column<ImportSessionRow>[] = [
    {
      key: "committed_at",
      label: "Date",
      sort: (a, b) => a.committed_at.localeCompare(b.committed_at),
      render: (r) => (
        <span className="mono">{formatMediumDate(r.committed_at.slice(0, 10))}</span>
      ),
    },
    {
      key: "entity_type",
      label: "Entity",
      sort: (a, b) => a.entity_type.localeCompare(b.entity_type),
      render: (r) => ENTITY_LABEL[r.entity_type],
    },
    {
      key: "actorName",
      label: "Actor",
      sort: (a, b) => a.actor_name.localeCompare(b.actor_name),
      render: (r) => <span className="muted">{r.actor_name}</span>,
    },
    {
      key: "row_count",
      label: "Rows",
      align: "r",
      sort: (a, b) => a.row_count - b.row_count,
      render: (r) => <span className="mono">{r.row_count}</span>,
    },
    {
      key: "new_refs",
      label: "New refs",
      align: "r",
      sort: (a, b) => refSum(a.created_refs) - refSum(b.created_refs),
      render: (r) => {
        const n = refSum(r.created_refs);
        return n > 0 ? <span className="mono">{n}</span> : <span className="muted subtle">0</span>;
      },
    },
    {
      key: "status",
      label: "Status",
      align: "c",
      sort: (a, b) => a.status.localeCompare(b.status),
      render: (r) =>
        r.status === "committed" ? (
          <span className="pill pill-sm p-success">Committed</span>
        ) : (
          <span className="pill pill-sm p-destructive">Rolled back</span>
        ),
    },
  ];

  return (
    <div className="stack-4">
      <div className="pagehead">
        <Link to="/settings" className="crumb">
          ← Back to Settings
        </Link>
        <h1 className="h-page" style={{ marginTop: 4 }}>
          Bulk Import · History
        </h1>
        <p className="muted" style={{ fontSize: 14, marginTop: 4 }}>
          Every committed bulk import, newest first. Admin-only.
        </p>
      </div>

      {loading ? (
        <div className="flex flex-col items-center gap-2 py-12">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
          <span className="cap">Loading import history...</span>
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: selected ? "1fr 360px" : "1fr",
            gap: 16,
            alignItems: "start",
          }}
        >
          <div className="stack-3">
            <FilterBar
              state={filterState}
              onChange={setFilterState}
              fields={fields}
            />
            {rows.length === 0 ? (
              <div className="rounded-md border border-dashed border-border py-12 text-center">
                <p className="text-sm text-muted-foreground">No bulk imports yet.</p>
              </div>
            ) : (
              <DataTable<ImportSessionRow>
                rows={filtered}
                flat
                columns={columns}
                onRowClick={(r) => setSelectedId(r.id)}
                empty={{ message: "No imports match your filters." }}
              />
            )}
          </div>

          {selected ? (
            <SessionDetailRail
              session={selected}
              onClose={() => setSelectedId(null)}
              onOpenList={() =>
                navigate(`/${ENTITY_PLURAL[selected.entity_type]}`, {
                  state: { bulkImportSessionId: selected.id },
                })
              }
              onUndone={(sessionId) => {
                setRows((prev) => prev.filter((r) => r.id !== sessionId));
                setSelectedId(null);
              }}
            />
          ) : null}
        </div>
      )}
    </div>
  );
}

function SessionDetailRail({
  session,
  onClose,
  onOpenList,
  onUndone,
}: {
  session: ImportSessionRow;
  onClose: () => void;
  onOpenList: () => void;
  onUndone: (sessionId: string) => void;
}) {
  // Hooks above any early return / conditional branch (brand §12).
  const [undoing, setUndoing] = useState(false);
  const [counts, setCounts] = useState<UndoCounts | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const refEntries = Object.entries(session.created_refs).filter(([, n]) => n > 0);
  const isRolledBack = session.status === "failed_rollback";
  const inUndoWindow =
    session.status === "committed" && committedWithinUndoWindow(session.committed_at);

  // Step 1: dry-run to get the cascade counts, then open the confirm dialog.
  async function startUndo() {
    setUndoing(true);
    try {
      const { data, error } = await supabase.functions.invoke("bulk-import", {
        body: { mode: "undo", session_id: session.id, dry_run: true },
      });
      if (error) {
        throw new Error(await invokeErrorMessage(error, "Couldn't prepare undo"));
      }
      const res = data as { ok?: boolean; counts?: UndoCounts; error?: string };
      if (!res?.ok || !res.counts) {
        throw new Error(res?.error ?? "Couldn't prepare undo");
      }
      setCounts(res.counts);
      setDialogOpen(true);
    } catch (e) {
      toast({
        title: "Couldn't undo import",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setUndoing(false);
    }
  }

  // Step 2 (dialog confirm): the real destructive undo.
  async function confirmUndo() {
    setUndoing(true);
    try {
      const { data, error } = await supabase.functions.invoke("bulk-import", {
        body: { mode: "undo", session_id: session.id, dry_run: false },
      });
      if (error) {
        throw new Error(await invokeErrorMessage(error, "Couldn't undo import"));
      }
      const res = data as { ok?: boolean; counts?: UndoCounts; error?: string };
      if (!res?.ok) {
        throw new Error(res?.error ?? "Couldn't undo import");
      }
      const removed = res.counts?.records ?? 0;
      setDialogOpen(false);
      toast({
        title: "Import undone",
        description: `${removed} record${removed === 1 ? "" : "s"} removed.`,
      });
      onUndone(session.id);
    } catch (e) {
      toast({
        title: "Couldn't undo import",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setUndoing(false);
    }
  }

  return (
    <aside className="card">
      <div className="card-headbar">
        <span className="h-card" style={{ fontSize: 16, flex: 1, minWidth: 0 }}>
          {ENTITY_LABEL[session.entity_type]} import
        </span>
        <button type="button" className="tlink" onClick={onClose} aria-label="Close panel">
          <IconX className="ic" />
        </button>
      </div>
      <div className="card-pad stack-3">
        <dl
          className="kv"
          style={{ gridTemplateColumns: "92px 1fr", gap: "8px 12px" }}
        >
          <dt>Date</dt>
          <dd>{formatMediumDate(session.committed_at.slice(0, 10))}</dd>
          <dt>Entity</dt>
          <dd>{ENTITY_LABEL[session.entity_type]}</dd>
          <dt>Actor</dt>
          <dd>{session.actor_name}</dd>
        </dl>

        <div>
          <div className="lead" style={{ marginBottom: 4 }}>
            Rows imported: {session.row_count}
          </div>
          {refEntries.length > 0 ? (
            <>
              <div className="cap" style={{ marginBottom: 4 }}>
                New references created:
              </div>
              <ul style={{ margin: 0, paddingLeft: 16, fontSize: 13, lineHeight: 1.6 }}>
                {refEntries.map(([key, n]) => (
                  <li key={key}>
                    {humanizeRefKey(key)}: {n}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <div className="muted subtle" style={{ fontSize: 13 }}>
              No new references created.
            </div>
          )}
        </div>

        {session.column_set.length > 0 ? (
          <div>
            <div className="cap" style={{ marginBottom: 6 }}>
              Imported columns:
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {session.column_set.map((c) => (
                <span key={c} className="pill pill-sm p-muted">
                  {c}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        {isRolledBack ? (
          <p className="muted" style={{ fontSize: 13, color: "hsl(var(--destructive))" }}>
            This import failed and was rolled back. No records were created.
          </p>
        ) : (
          <>
            <button type="button" className="btn btn-secondary" onClick={onOpenList}>
              Open list
            </button>
            {inUndoWindow ? (
              <button
                type="button"
                className="btn btn-secondary"
                style={{ color: "hsl(var(--destructive))" }}
                onClick={startUndo}
                disabled={undoing}
              >
                {undoing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Undo import"
                )}
              </button>
            ) : (
              <p className="muted subtle" style={{ fontSize: 13 }}>
                Undo window closed (imports older than {BULK_IMPORT_UNDO_WINDOW_DAYS} days
                can't be reverted).
              </p>
            )}
          </>
        )}
      </div>

      <AlertDialog open={dialogOpen} onOpenChange={(open) => !open && setDialogOpen(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Undo this import?</AlertDialogTitle>
            <AlertDialogDescription>
              {counts ? buildUndoDescription(counts) : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={undoing}>Keep import</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void confirmUndo();
              }}
              disabled={undoing}
              style={{
                backgroundColor: "hsl(var(--destructive))",
                color: "hsl(var(--destructive-foreground))",
              }}
            >
              {undoing ? <Loader2 className="h-4 w-4 animate-spin" /> : "Undo import"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </aside>
  );
}
