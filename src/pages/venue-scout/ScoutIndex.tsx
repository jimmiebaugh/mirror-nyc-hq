import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ChevronDown, ChevronRight, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import {
  currentStepToLabel,
  isInProgress,
  relativeTime,
  statusPill,
  stepToRoute,
} from "@/lib/venue-scout/format";

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

const GRID = "grid-cols-[1.5fr_1fr_1fr_160px_140px_140px]";

function RowHeader() {
  return (
    <div
      className={`grid ${GRID} gap-4 border-b border-border bg-secondary/30 px-6 py-3 text-[13px] font-mono font-bold uppercase tracking-wider text-muted-foreground`}
    >
      <div>Project / Client</div>
      <div>Live Date(s)</div>
      <div>Phase</div>
      <div>Status</div>
      <div>Last Updated</div>
      <div />
    </div>
  );
}

function ScoutRow({
  s,
  archived,
  onArchive,
  onRestore,
  onDelete,
}: {
  s: Scout;
  archived?: boolean;
  onArchive?: (id: string) => void;
  onRestore?: (id: string) => void;
  onDelete?: (s: Scout) => void;
}) {
  const navigate = useNavigate();
  const pill = statusPill(s.status);
  const resume = !archived && isInProgress(s.current_step);
  return (
    <div
      onClick={() => navigate(stepToRoute(s.id, s.current_step))}
      className={`group relative grid ${GRID} cursor-pointer items-center gap-4 border-b border-border px-6 py-5 last:border-b-0 transition-colors hover:bg-secondary/40`}
    >
      {!archived && onArchive && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onArchive(s.id);
          }}
          className="absolute left-1.5 top-1/2 -translate-y-1/2 p-1 text-primary opacity-0 transition-opacity hover:scale-110 group-hover:opacity-100"
          title="Archive"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
      <div className="min-w-0">
        <div className="truncate text-sm font-bold">{s.event_name ?? "Untitled"}</div>
        <div className="mt-0.5 truncate text-xs text-muted-foreground">{s.client_name ?? ""}</div>
      </div>
      <div className="text-xs text-muted-foreground">{s.live_dates ?? "-"}</div>
      <div className="text-xs text-muted-foreground">{currentStepToLabel(s.current_step)}</div>
      <div>
        <span
          className={`inline-flex h-7 items-center rounded-full border px-2 text-[10.5px] font-mono font-bold uppercase tracking-wider ${pill.cls}`}
        >
          <span className={`mr-1.5 h-1.5 w-1.5 rounded-full ${pill.dot}`} />
          {pill.label}
        </span>
      </div>
      <div className="text-xs text-muted-foreground">{relativeTime(s.last_touched_at)}</div>
      {archived ? (
        <div
          className="flex items-center justify-end gap-3"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => onRestore?.(s.id)}
            className="text-[13px] font-mono font-bold uppercase tracking-wider text-primary hover:underline"
          >
            Restore
          </button>
          <button
            type="button"
            onClick={() => onDelete?.(s)}
            className="text-[13px] font-mono font-bold uppercase tracking-wider text-red-400 hover:text-red-300 hover:underline"
          >
            Delete
          </button>
        </div>
      ) : resume ? (
        <span className="justify-self-end whitespace-nowrap text-[11px] font-bold uppercase tracking-[0.14em] text-primary">
          Resume Search →
        </span>
      ) : (
        <ChevronRight className="h-4 w-4 justify-self-end text-muted-foreground/60" />
      )}
    </div>
  );
}

export default function ScoutIndex() {
  const [scouts, setScouts] = useState<Scout[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [archivedOpen, setArchivedOpen] = useState(false);
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
    // FK CASCADE on vs_candidate_venues + vs_venue_photos handles the row
    // cleanup. Storage objects in the venue_photos bucket are NOT cascaded;
    // a future cleanup cron will sweep orphaned files (parity with TS).
    const { error } = await supabase.from("vs_scouts").delete().eq("id", pendingDelete.id);
    setDeleting(false);
    if (error) {
      toast({ title: "Delete failed", description: error.message, variant: "destructive" });
      return;
    }
    const label = pendingDelete.event_name ?? "project";
    setPendingDelete(null);
    toast({ title: `Deleted "${label}"` });
    void load();
  };

  const active = (scouts ?? []).filter((s) => !s.archived_at);
  const archived = (scouts ?? []).filter((s) => !!s.archived_at);

  return (
    <div className="space-y-8">
      <header className="flex items-end justify-between gap-5">
        <div className="space-y-2">
          <div className="text-[14px] font-mono uppercase tracking-widest text-primary">
            Venue Scout
          </div>
          <h1 className="h-page">Open Projects</h1>
          <p className="text-sm text-muted-foreground">
            Active and recent venue sourcing projects.
          </p>
        </div>
        <Button asChild>
          <Link to="/venue-scout/scouts/new">
            <Plus className="mr-2 h-4 w-4" />
            New Project
          </Link>
        </Button>
      </header>

      <Card className="overflow-hidden">
        <RowHeader />
        {loading ? (
          <div className="px-6 py-12 text-center text-sm text-muted-foreground">Loading…</div>
        ) : active.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-muted-foreground">
            No active projects.
          </div>
        ) : (
          active.map((s) => <ScoutRow key={s.id} s={s} onArchive={archive} />)
        )}
      </Card>

      <div>
        <button
          type="button"
          onClick={() => setArchivedOpen((v) => !v)}
          className="flex w-full items-center gap-3 rounded-md border border-border bg-card px-5 py-3 text-left text-[13px] font-mono font-bold uppercase tracking-wider transition-colors hover:bg-secondary/40"
        >
          <ChevronDown
            className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${archivedOpen ? "" : "-rotate-90"}`}
          />
          <span>Archived Projects</span>
          <span className="ml-auto rounded-full border border-border bg-secondary px-2.5 py-0.5 text-[11px] font-semibold text-muted-foreground">
            {archived.length}
          </span>
        </button>
        {archivedOpen && (
          <Card className="mt-3 overflow-hidden">
            <RowHeader />
            {archived.length === 0 ? (
              <div className="px-6 py-8 text-center text-sm text-muted-foreground">
                No archived projects.
              </div>
            ) : (
              archived.map((s) => (
                <ScoutRow
                  key={s.id}
                  s={s}
                  archived
                  onRestore={restore}
                  onDelete={openDelete}
                />
              ))
            )}
          </Card>
        )}
      </div>

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
              className="bg-red-500 text-white hover:bg-red-600"
            >
              {deleting ? "Deleting…" : "Delete Project"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
