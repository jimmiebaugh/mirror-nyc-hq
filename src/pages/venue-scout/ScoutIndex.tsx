import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Plus, X, RotateCcw, Archive } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { DataTable, type Column } from "@/components/data/DataTable";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import {
  currentStepToLabel,
  relativeTime,
  stepToRoute,
} from "@/lib/venue-scout/format";
import type { StatusToken } from "@/lib/home/projectStatusToken";

type Scout = {
  id: string;
  client_name: string | null;
  event_name: string | null;
  live_dates: string | null;
  status: string;
  current_step: string;
  archived_at: string | null;
  last_touched_at: string;
};

// R7 amendment v3 § 1.7: Status column dropped from the table render. The
// `status` field still loads from the row (other consumers may read it);
// only the Phase column renders now. § 1.8: phase → pill token mapping
// renders the Phase column as design-system pills.
//
// Mapping (Implementer's call, producer-revisable):
//   - brief / sheet_prompt  → muted   (intake start, neutral)
//   - sheet_upload          → muted   (still in intake)
//   - researching           → info    (data-gathering, blue)
//   - sourcing_report       → info    (sourcing in progress, blue)
//   - shortlist             → purple  (active shortlist, decisive)
//   - review_selects        → warn    (active review, amber)
//   - compiling             → warn    (active processing)
//   - deck_prep             → warn    (active assessment)
//   - completed             → success (terminal, green)
const SCOUT_PHASE_TOKENS: Record<string, StatusToken> = {
  brief: "muted",
  sheet_prompt: "muted",
  sheet_upload: "muted",
  researching: "info",
  sourcing_report: "info",
  shortlist: "purple",
  review_selects: "warn",
  compiling: "warn",
  deck_prep: "warn",
  completed: "success",
};

function scoutPhaseToken(step: string | null | undefined): StatusToken {
  if (!step) return "muted";
  return SCOUT_PHASE_TOKENS[step] ?? "muted";
}

export default function ScoutIndex() {
  const navigate = useNavigate();
  const [scouts, setScouts] = useState<Scout[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingDelete, setPendingDelete] = useState<Scout | null>(null);
  const [deleteCounts, setDeleteCounts] = useState<{ candidates: number; photos: number } | null>(
    null,
  );
  const [deleting, setDeleting] = useState(false);
  // Generation counter so a stale openDelete query (e.g. user closes
  // dialog A and opens dialog B before A's counts arrive) can't write
  // counts for the wrong scout.
  const openDeleteGenRef = useRef(0);

  const load = async () => {
    const { data, error } = await supabase
      .from("vs_scouts")
      .select(
        "id, client_name, event_name, live_dates, status, current_step, archived_at, last_touched_at",
      )
      .order("last_touched_at", { ascending: false });
    if (error) {
      toast({ title: "Could not load projects", description: error.message, variant: "destructive" });
      setScouts([]);
      return;
    }
    setScouts((data ?? []) as Scout[]);
  };

  useEffect(() => {
    let active = true;
    (async () => {
      await load();
      if (active) setLoading(false);
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const archive = async (id: string) => {
    const stamp = new Date().toISOString();
    setScouts((prev) =>
      prev?.map((s) => (s.id === id ? { ...s, archived_at: stamp } : s)) ?? prev,
    );
    const { error } = await supabase
      .from("vs_scouts")
      .update({ archived_at: stamp })
      .eq("id", id);
    if (error) {
      toast({ title: "Archive failed", description: error.message, variant: "destructive" });
      void load();
      return;
    }
    toast({ title: "Project archived" });
  };

  const restore = async (id: string) => {
    setScouts((prev) =>
      prev?.map((s) => (s.id === id ? { ...s, archived_at: null } : s)) ?? prev,
    );
    const { error } = await supabase
      .from("vs_scouts")
      .update({ archived_at: null })
      .eq("id", id);
    if (error) {
      toast({ title: "Restore failed", description: error.message, variant: "destructive" });
      void load();
      return;
    }
    toast({ title: "Project restored" });
  };

  const openDelete = async (s: Scout) => {
    const gen = ++openDeleteGenRef.current;
    setPendingDelete(s);
    setDeleteCounts(null);
    const { data: cands } = await supabase
      .from("vs_candidate_venues")
      .select("id")
      .eq("scout_id", s.id);
    const candidateIds = (cands ?? []).map((c) => c.id);
    let photos = 0;
    if (candidateIds.length) {
      const { count } = await supabase
        .from("vs_venue_photos")
        .select("id", { count: "exact", head: true })
        .in("candidate_venue_id", candidateIds);
      photos = count ?? 0;
    }
    if (gen !== openDeleteGenRef.current) return;
    setDeleteCounts({ candidates: candidateIds.length, photos });
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    // Phase 5.12.6: vs-delete-scout enumerates storage paths, runs the DB
    // DELETE (FK CASCADE handles vs_sourcing_rounds + vs_candidate_venues +
    // vs_venue_photos rows), then sweeps the briefs / sourcing_sheets /
    // vs_venue_photos buckets in service-role. Per-bucket storage failures
    // surface as a destructive toast but do not roll back the delete.
    const { data, error } = await supabase.functions.invoke("vs-delete-scout", {
      body: { scout_id: pendingDelete.id },
    });
    setDeleting(false);
    if (error || !data?.ok) {
      let message = error?.message ?? data?.message ?? data?.error ?? "Unknown error";
      const ctx = (error as { context?: Response } | null)?.context;
      if (ctx && typeof ctx.json === "function") {
        try {
          const body = await ctx.json();
          if (body?.message) message = body.message;
          else if (body?.error) message = body.error;
        } catch {
          // body wasn't JSON; fall back to the message above.
        }
      }
      toast({ title: "Delete failed", description: message, variant: "destructive" });
      return;
    }
    const label = pendingDelete.event_name ?? "project";
    const counts = data.counts as {
      candidate_venues: number;
      briefs_removed: number;
      sheets_removed: number;
      photos_removed: number;
    };
    const parts: string[] = [];
    if (counts.candidate_venues > 0) {
      parts.push(`${counts.candidate_venues} venue${counts.candidate_venues === 1 ? "" : "s"}`);
    }
    if (counts.photos_removed > 0) {
      parts.push(`${counts.photos_removed} photo${counts.photos_removed === 1 ? "" : "s"}`);
    }
    if (counts.briefs_removed > 0) {
      parts.push(`${counts.briefs_removed} brief file${counts.briefs_removed === 1 ? "" : "s"}`);
    }
    if (counts.sheets_removed > 0) {
      parts.push(`${counts.sheets_removed} sheet file${counts.sheets_removed === 1 ? "" : "s"}`);
    }
    const summary = parts.length > 0 ? ` (${parts.join(", ")})` : "";
    setPendingDelete(null);
    toast({ title: `Deleted "${label}"${summary}` });
    const storageErrors = data.storage_errors as
      | Array<{ bucket: string; message: string }>
      | undefined;
    if (storageErrors && storageErrors.length > 0) {
      const buckets = Array.from(new Set(storageErrors.map((e) => e.bucket))).join(", ");
      toast({
        title: "Some files could not be removed",
        description: `Project deleted, but storage cleanup failed for: ${buckets}. Safe to ignore.`,
        variant: "destructive",
      });
    }
    void load();
  };

  const rows = scouts ?? [];
  const activeCount = rows.filter((s) => !s.archived_at).length;

  const columns: Column<Scout>[] = [
    {
      key: "project",
      label: "Project / Client",
      sort: (a, b) => (a.event_name ?? "").localeCompare(b.event_name ?? ""),
      render: (s) => (
        <div>
          <div>
            {/* R7 amendment v3 § 1.3 → R7 amendment v4 § 3: project title
                reverted from 16px back to 13.5px per producer call. */}
            <Link
              to={stepToRoute(s.id, s.current_step)}
              className="lead"
              style={{ fontSize: 13.5 }}
              onClick={(e) => e.stopPropagation()}
            >
              {s.event_name ?? "Untitled"}
            </Link>
          </div>
          {s.client_name ? (
            // R7 amendment v3 § 1.4 → R7 amendment v4 § 4: client name
            // reverted from 15px back to 12px per producer call.
            <div
              className="sub"
              style={{
                color: "hsl(var(--primary-hover))",
                fontSize: 12,
              }}
            >
              {s.client_name}
            </div>
          ) : null}
        </div>
      ),
    },
    {
      key: "live",
      label: "Live Date(s)",
      // R7 amendment v3 § 1.9: width bumped from 140 → 180 so date
      // strings don't wrap at common widths.
      width: 180,
      align: "c",
      // R7 amendment v3 § 1.5: drop `mono` so the cell renders in the
      // body font (Roboto). `muted` color treatment preserved.
      render: (s) => (
        <span className="muted">{s.live_dates ?? "-"}</span>
      ),
    },
    {
      key: "phase",
      label: "Phase",
      width: 130,
      align: "c",
      // R7 amendment v3 § 1.8: phase renders as a design-system pill via
      // the per-step token map at module-level. Was plain muted text.
      render: (s) => {
        const token = scoutPhaseToken(s.current_step);
        return (
          <span className={`pill pill-sm p-${token}`}>
            <span className="dt" style={{ background: "currentColor" }} />
            {currentStepToLabel(s.current_step)}
          </span>
        );
      },
    },
    // R7 amendment v3 § 1.7: Status column removed from render. The
    // `status` field still loads from the row for any downstream
    // consumer; the column object is just no longer in the table.
    {
      key: "last_touched",
      label: "Last Updated",
      width: 130,
      align: "c",
      sort: (a, b) => a.last_touched_at.localeCompare(b.last_touched_at),
      // R7 amendment v3 § 1.5: drop `mono` so the cell renders in the
      // body font (Roboto). Color treatment preserved.
      render: (s) => (
        <span className="muted">{relativeTime(s.last_touched_at)}</span>
      ),
    },
    {
      key: "actions",
      label: "",
      // R6 § B.3: Resume affordance dropped (whole row is clickable to
      // resume); column trimmed to fit just the archive icon + padding.
      // R7 amendment v3 § 1.6: align changed `r` → `c` so the archive
      // icon centers horizontally inside the cell.
      width: 80,
      align: "c",
      render: (s) => {
        const archived = s.archived_at != null;
        if (archived) {
          // R6 § B.4 → R6 amendment v1 § 5 → R7 amendment v3 § 1.6:
          // archived rows stack Restore above Delete vertically; align
          // center horizontally (was items-end) to match the cell's new
          // center alignment.
          return (
            <div
              className="flex flex-col items-center gap-1.5"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={() => void restore(s.id)}
                className="text-[10px] font-mono font-bold uppercase tracking-wider text-primary hover:underline"
                title="Restore"
              >
                <RotateCcw className="inline h-3 w-3 mr-1" />
                Restore
              </button>
              <button
                type="button"
                onClick={() => void openDelete(s)}
                className="text-[10px] font-mono font-bold uppercase tracking-wider text-destructive hover:underline"
                title="Delete permanently"
              >
                <X className="inline h-3 w-3 mr-1" />
                Delete
              </button>
            </div>
          );
        }
        return (
          // R7 amendment v3 § 1.6: archive icon centers horizontally
          // inside the cell. Vertical centering already handled by the
          // .tbl tbody td's `vertical-align: middle`.
          <div
            className="flex items-center justify-center"
            onClick={(e) => e.stopPropagation()}
          >
            {/* R6 § B.3: inline "Resume →" affordance retired; the whole
                row is already clickable to resume. */}
            <button
              type="button"
              onClick={() => void archive(s.id)}
              className="text-muted-foreground transition-colors hover:text-foreground"
              title="Archive"
              aria-label={`Archive ${s.event_name ?? "project"}`}
            >
              <Archive className="h-4 w-4" />
            </button>
          </div>
        );
      },
    },
  ];

  return (
    // R6 § B.2: stack-4 → stack-6 (24px) gives the title row more breathing
    // room above the table, matching the title→content gap on ClientsList
    // (which has a filter bar inserted between title + table that creates
    // visually equivalent vertical rhythm).
    <div className="stack-6">
      <div className="row between list-head">
        <h1 className="h-page">Venue Scouts</h1>
        {/* R7 amendment v1 § 4: revert R7's modal-shortcut. ScoutIndex
            funnels through Overview (the flow explainer); Overview's
            own CTA opens the NewScoutModal. Label renamed
            "New Project" → "+ New Scout" for consistency with the
            sidebar entry. */}
        <Button asChild>
          <Link to="/venue-scout/overview">
            <Plus className="mr-2 h-4 w-4" />
            New Scout
          </Link>
        </Button>
      </div>

      {loading ? (
        <div className="empty">
          <p>Loading…</p>
        </div>
      ) : (
        <>
          {/* R7 amendment v2 § 2: scout-list-tbl wrapper scopes matrix
              visual contract (header bg, centered headers, column
              dividers, no `::after` pseudo bar) without the matrix's
              sticky col / 1280 min-width / table-fixed. */}
          <div className="scout-list-tbl">
            <DataTable<Scout>
              rows={rows}
              flat
              columns={columns}
              onRowClick={(s) =>
                s.archived_at ? undefined : navigate(stepToRoute(s.id, s.current_step))
              }
              twoTier={{
                isTerminal: (s) => s.archived_at != null,
                dividerLabel: (n) => `Archived Projects · ${n} hidden`,
              }}
              empty={{
                message: "No active projects",
                ctaLabel: "+ New Scout",
                // R7 amendment v1 § 4: empty-state CTA routes to Overview
                // (matches header). Overview's button opens the modal.
                onCta: () => navigate("/venue-scout/overview"),
              }}
            />
          </div>
          <span className="cap">{activeCount} projects</span>
        </>
      )}

      <AlertDialog
        open={!!pendingDelete}
        onOpenChange={(o) => !o && setPendingDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this project permanently?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <div>This will delete:</div>
                <ul className="list-disc space-y-1 pl-5">
                  <li>{deleteCounts?.candidates ?? "…"} candidate venues</li>
                  <li>{deleteCounts?.photos ?? "…"} venue photos (Storage files are not cascaded)</li>
                  <li>The brief, derived columns, and all generated decks</li>
                </ul>
                <div className="pt-2 font-semibold text-foreground">This cannot be undone.</div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? "Deleting…" : "Delete Project"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
