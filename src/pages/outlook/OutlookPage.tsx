import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { OutlookYearGrid } from "@/components/outlook/YearGrid";
import {
  OutlookEntryPanel,
  type NewEntryDefaults,
} from "@/components/outlook/EntryPanel";
import { IconPlus } from "@/components/icons/HQIcons";
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
import {
  loadOutlookEntriesForYear,
  loadDistinctOutlookYears,
  createOutlookEntry,
  updateOutlookEntry,
  updateOutlookConfidence,
  deleteOutlookEntry,
  unlinkOutlookProject,
  promoteOutlookToProject,
  type OutlookEntry,
  type OutlookEntryInput,
} from "@/lib/outlook/queries";
import { toast } from "@/hooks/use-toast";

/**
 * Surface 16 Outlook page (admin-only via AdminRoute).
 * Wireframe binding: OUTPUTS/phase-5-hq-wireframe-v1-LOCKED.html
 * Surface 16. Spec: OUTPUTS/phase-5-3-spec.md § 4b.
 *
 * 12-month grid with year tabs and a 277px side panel. The panel handles
 * detail / edit / new modes. URL params:
 *   ?year=YYYY            pre-selects the year tab
 *   ?month=MM             reserved for future scroll behavior (not used
 *                          in the v1 grid which always shows 12 months)
 *   #entry=<uuid>         pre-selects the entry on load (used by the
 *                          Calendar shared-Outlook click target)
 */

type PanelMode = "detail" | "edit" | "new" | "none";

export default function OutlookPage() {
  const [searchParams] = useSearchParams();
  const yearParam = Number(searchParams.get("year"));
  const initialYear =
    Number.isFinite(yearParam) && yearParam >= 2024
      ? yearParam
      : new Date().getFullYear();

  const queryClient = useQueryClient();
  const [activeYear, setActiveYear] = useState<number>(initialYear);
  const [extraYears, setExtraYears] = useState<number[]>([]);
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [panelMode, setPanelMode] = useState<PanelMode>("none");
  const [newDefaults, setNewDefaults] = useState<NewEntryDefaults | null>(null);
  const [confirmAddYearOpen, setConfirmAddYearOpen] = useState(false);
  const [pendingAddYear, setPendingAddYear] = useState<number | null>(null);

  const entriesQuery = useQuery({
    queryKey: ["outlook-entries", activeYear],
    queryFn: () => loadOutlookEntriesForYear(activeYear),
  });

  const yearsQuery = useQuery({
    queryKey: ["outlook-years"],
    queryFn: loadDistinctOutlookYears,
  });

  // Year-tab derivation: distinct years from data + currentYear + manually
  // added empty year tabs. Sorted descending.
  const currentYear = new Date().getFullYear();
  const years = useMemo(() => {
    const set = new Set<number>();
    set.add(currentYear);
    set.add(activeYear);
    for (const y of yearsQuery.data ?? []) set.add(y);
    for (const y of extraYears) set.add(y);
    return Array.from(set).sort((a, b) => b - a);
  }, [yearsQuery.data, extraYears, activeYear, currentYear]);

  // Hash-based entry pre-select (from Calendar shared-banner click).
  useEffect(() => {
    const hash = window.location.hash;
    const match = hash.match(/^#entry=([0-9a-f-]{36})$/i);
    if (match) {
      setSelectedEntryId(match[1]);
      setPanelMode("detail");
    }
  }, []);

  // Resolve the selected entry from the loaded list.
  const selectedEntry: OutlookEntry | null = useMemo(() => {
    if (!selectedEntryId) return null;
    const list = entriesQuery.data ?? [];
    return list.find((e) => e.id === selectedEntryId) ?? null;
  }, [entriesQuery.data, selectedEntryId]);

  // Mutations.
  const createMut = useMutation({
    mutationFn: (input: OutlookEntryInput) => createOutlookEntry(input),
    onSuccess: (entry) => {
      queryClient.invalidateQueries({ queryKey: ["outlook-entries"] });
      queryClient.invalidateQueries({ queryKey: ["outlook-years"] });
      setSelectedEntryId(entry.id);
      setPanelMode("detail");
      setActiveYear(entry.year);
      toast({ title: "Outlook entry created" });
    },
    onError: (err) =>
      toast({
        title: "Save failed",
        description: (err as Error).message,
        variant: "destructive",
      }),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: OutlookEntryInput }) =>
      updateOutlookEntry(id, patch),
    onSuccess: (entry) => {
      queryClient.invalidateQueries({ queryKey: ["outlook-entries"] });
      setSelectedEntryId(entry.id);
      setPanelMode("detail");
      toast({ title: "Saved" });
    },
    onError: (err) =>
      toast({
        title: "Save failed",
        description: (err as Error).message,
        variant: "destructive",
      }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteOutlookEntry(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["outlook-entries"] });
      setSelectedEntryId(null);
      setPanelMode("none");
      toast({ title: "Outlook entry deleted" });
    },
    onError: (err) =>
      toast({
        title: "Delete failed",
        description: (err as Error).message,
        variant: "destructive",
      }),
  });

  const promoteMut = useMutation({
    mutationFn: (id: string) => promoteOutlookToProject(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["outlook-entries"] });
      toast({ title: "Promoted to Project" });
    },
    onError: (err) =>
      toast({
        title: "Promote failed",
        description: (err as Error).message,
        variant: "destructive",
      }),
  });

  const unlinkMut = useMutation({
    mutationFn: (id: string) => unlinkOutlookProject(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["outlook-entries"] });
      toast({ title: "Unlinked from Project" });
    },
    onError: (err) =>
      toast({
        title: "Unlink failed",
        description: (err as Error).message,
        variant: "destructive",
      }),
  });

  // Handlers.
  const openNewEntry = () => {
    setSelectedEntryId(null);
    setNewDefaults({
      year: activeYear,
      month: new Date().getMonth() + 1,
      week: 1,
    });
    setPanelMode("new");
  };

  const requestAddYear = () => {
    const last = Math.max(...years);
    setPendingAddYear(last + 1);
    setConfirmAddYearOpen(true);
  };

  const confirmAddYear = () => {
    if (pendingAddYear != null) {
      setExtraYears((arr) => [...arr, pendingAddYear]);
      setActiveYear(pendingAddYear);
    }
    setPendingAddYear(null);
    setConfirmAddYearOpen(false);
  };

  const entries = entriesQuery.data ?? [];

  return (
    <div className="stack-4">
      <div className="pagehead">
        <div className="row between">
          <div>
            <div className="eyebrow">Admin</div>
            <h1 className="h-page" style={{ marginTop: 4 }}>
              Outlook
            </h1>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            onClick={openNewEntry}
          >
            <IconPlus className="ic" /> New Outlook Entry
          </button>
        </div>
      </div>

      <div className="tabs">
        {years.map((y) => (
          <button
            key={y}
            type="button"
            className={y === activeYear ? "on" : ""}
            onClick={() => setActiveYear(y)}
          >
            {y}
          </button>
        ))}
        <button type="button" onClick={requestAddYear}>
          + Add year
        </button>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: panelMode === "none" ? "1fr" : "1fr 277px",
          gap: 16,
          alignItems: "start",
        }}
      >
        <div className="stack-3">
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <div className="ol-legend">
              <span>
                <i style={{ background: "hsl(var(--warn))" }} /> On Radar
              </span>
              <span>
                <i style={{ background: "hsl(var(--info))" }} /> Likely
              </span>
              <span>
                <i style={{ background: "hsl(var(--success))" }} /> Confirmed
              </span>
              <span>
                <i style={{ background: "hsl(var(--border-strong))" }} /> Complete
              </span>
            </div>
          </div>
          <OutlookYearGrid
            entries={entries}
            selectedEntryId={selectedEntryId}
            loading={entriesQuery.isLoading}
            onSelectEntry={(id) => {
              setSelectedEntryId(id);
              setPanelMode("detail");
            }}
          />
          <span className="cap">
            {entries.length} {entries.length === 1 ? "entry" : "entries"} in {activeYear}
          </span>
        </div>

        {panelMode === "none" ? null : (
          <OutlookEntryPanel
            mode={panelMode}
            entry={selectedEntry}
            newDefaults={panelMode === "new" ? newDefaults : null}
            saving={createMut.isPending || updateMut.isPending}
            onClose={() => {
              setPanelMode("none");
              setSelectedEntryId(null);
            }}
            onBeginEdit={() => setPanelMode("edit")}
            onCancelEdit={() => {
              if (panelMode === "new") {
                setPanelMode("none");
                setSelectedEntryId(null);
              } else {
                setPanelMode("detail");
              }
            }}
            onSave={async (input) => {
              if (panelMode === "new") {
                await createMut.mutateAsync(input);
              } else if (selectedEntry) {
                await updateMut.mutateAsync({
                  id: selectedEntry.id,
                  patch: input,
                });
              }
            }}
            onDelete={async () => {
              if (selectedEntry) await deleteMut.mutateAsync(selectedEntry.id);
            }}
            onPromote={async () => {
              if (selectedEntry) await promoteMut.mutateAsync(selectedEntry.id);
            }}
            onUnlink={async () => {
              if (selectedEntry) await unlinkMut.mutateAsync(selectedEntry.id);
            }}
            onConfidenceChange={async (id, next) => {
              await updateOutlookConfidence(id, next);
              queryClient.invalidateQueries({ queryKey: ["outlook-entries"] });
            }}
          />
        )}
      </div>

      <AlertDialog open={confirmAddYearOpen} onOpenChange={setConfirmAddYearOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Add year {pendingAddYear}?</AlertDialogTitle>
            <AlertDialogDescription>
              Opens an empty grid for {pendingAddYear}. No entries are
              created until you click New Outlook Entry.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmAddYear}>Add</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
