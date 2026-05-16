import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  IconChevronDown,
  IconChevronRight,
  IconPlus,
  IconX,
} from "@/components/icons/HQIcons";
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
import { formatMediumDate } from "@/lib/hq/dates";
import { toast } from "@/hooks/use-toast";

type Holiday = {
  id: string;
  name: string;
  date: string;
};

/**
 * Settings Mirror Holidays card. CRUD against the mirror_holidays table.
 * The unified Calendar page reads from the same table (5.4 rewire of
 * src/lib/calendar/holidays.ts), so changes here propagate on next load.
 *
 * Phase 5.4 feedback: collapsed-by-default so the Settings page stays
 * tight. Click the headbar to expand; rows are lazy-loaded on first expand.
 */
export function MirrorHolidaysEditor({
  defaultExpanded = false,
}: {
  defaultExpanded?: boolean;
}) {
  const { user } = useAuth();
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [rows, setRows] = useState<Holiday[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDate, setNewDate] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<Holiday | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("mirror_holidays")
      .select("id, name, date")
      .order("date", { ascending: true });
    if (error) {
      console.warn("mirror_holidays load failed", error);
      setRows([]);
    } else {
      setRows((data ?? []) as Holiday[]);
    }
    setLoading(false);
  }, []);

  // Defer the first load until the panel is expanded.
  useEffect(() => {
    if (expanded) load();
  }, [expanded, load]);

  const commitAdd = async () => {
    if (!newName.trim() || !newDate) {
      toast({ title: "Name and date are required", variant: "destructive" });
      return;
    }
    const { error } = await supabase.from("mirror_holidays").insert({
      name: newName.trim(),
      date: newDate,
      created_by: user?.id ?? null,
    });
    if (error) {
      toast({ title: "Add failed", description: error.message, variant: "destructive" });
      return;
    }
    setNewName("");
    setNewDate("");
    setAdding(false);
    toast({ title: "Holiday added" });
    await load();
  };

  const doDelete = async () => {
    if (!confirmDelete) return;
    const { id, name } = confirmDelete;
    setConfirmDelete(null);
    const { error } = await supabase.from("mirror_holidays").delete().eq("id", id);
    if (error) {
      toast({ title: "Delete failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: `Removed "${name}"` });
    await load();
  };

  return (
    <div className="card">
      <div
        className="card-headbar"
        style={{ cursor: "pointer" }}
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="row-c" style={{ gap: 8, alignItems: "center" }}>
          {expanded ? (
            <IconChevronDown
              className="ic ic-sm"
              style={{ color: "hsl(var(--subtle-foreground))" }}
            />
          ) : (
            <IconChevronRight
              className="ic ic-sm"
              style={{ color: "hsl(var(--subtle-foreground))" }}
            />
          )}
          <span className="h-card">Mirror Holidays</span>
          {!expanded ? <span className="cap" style={{ marginLeft: 4 }}>click to expand</span> : null}
        </span>
        {expanded ? (
          <button
            type="button"
            className="tlink"
            onClick={(e) => {
              e.stopPropagation();
              setAdding((v) => !v);
            }}
            style={{ background: "none", border: "none" }}
          >
            <IconPlus className="ic ic-sm" />
            {adding ? "Cancel" : "Add Holiday"}
          </button>
        ) : null}
      </div>
      {!expanded ? null : loading ? (
        <div className="card-pad"><p className="cap">Loading...</p></div>
      ) : (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Name</th>
                <th>Date</th>
                <th className="r" style={{ width: 40 }}></th>
              </tr>
            </thead>
            <tbody>
              {adding ? (
                <tr>
                  <td>
                    <input
                      autoFocus
                      className={`input ${newName ? "input--filled" : ""}`}
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      placeholder="Holiday name"
                      style={{ height: 32 }}
                    />
                  </td>
                  <td>
                    <input
                      type="date"
                      className={`input ${newDate ? "input--filled" : ""}`}
                      value={newDate}
                      onChange={(e) => setNewDate(e.target.value)}
                      style={{ height: 32 }}
                    />
                  </td>
                  <td className="r">
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={commitAdd}
                    >
                      Save
                    </button>
                  </td>
                </tr>
              ) : null}
              {rows.length === 0 && !adding ? (
                <tr>
                  <td colSpan={3} className="muted subtle" style={{ textAlign: "center", padding: 24 }}>
                    No holidays yet.
                  </td>
                </tr>
              ) : null}
              {rows.map((h) => (
                <tr key={h.id}>
                  <td className="lead">{h.name}</td>
                  <td className="muted">{formatMediumDate(h.date)}</td>
                  <td className="r">
                    <button
                      type="button"
                      className="ca"
                      onClick={() => setConfirmDelete(h)}
                      title="Delete"
                      aria-label={`Delete ${h.name}`}
                    >
                      <IconX className="ic ic-sm" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <AlertDialog open={Boolean(confirmDelete)} onOpenChange={(open) => !open && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove "{confirmDelete?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              The holiday will be removed from the unified Calendar on the
              next page load.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={doDelete}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
