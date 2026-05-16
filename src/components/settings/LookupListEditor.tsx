import { useState } from "react";
import { IconPlus, IconX } from "@/components/icons/HQIcons";
import { useLookup, type LookupTable } from "@/lib/hq/lookups";
import { supabase } from "@/integrations/supabase/client";
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
import { toast } from "@/hooks/use-toast";

/**
 * Reusable inline tag-CRUD editor for lookup tables. Used by:
 *   - Settings Project Categories card
 *   - Settings Cities card
 *   - Settings Other Lookup Lists (rendered per row)
 *
 * Add: inline text input that appears next to "+ Add" and grows into a
 * new tag on Enter.
 * Delete: X icon on each tag with confirmation dialog (per spec § 9).
 */
export function LookupListEditor({ table, layout = "tags" }: { table: LookupTable; layout?: "tags" | "list" }) {
  const { options, addOption } = useLookup(table);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; name: string } | null>(null);
  const [optimisticDeletes, setOptimisticDeletes] = useState<Set<string>>(new Set());

  const visible = options.filter((o) => !optimisticDeletes.has(o.id));

  const commitAdd = async () => {
    const trimmed = newName.trim();
    if (!trimmed) {
      setAdding(false);
      return;
    }
    const result = await addOption(trimmed);
    if (!result) {
      toast({ title: "Add failed", description: "Name may already exist", variant: "destructive" });
    } else {
      toast({ title: `Added "${trimmed}"` });
    }
    setNewName("");
    setAdding(false);
  };

  const doDelete = async () => {
    if (!confirmDelete) return;
    const { id, name } = confirmDelete;
    setConfirmDelete(null);
    // Optimistic: hide row immediately. Re-show on error.
    setOptimisticDeletes((prev) => new Set(prev).add(id));
    const { error } = await supabase.from(table).delete().eq("id", id);
    if (error) {
      setOptimisticDeletes((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      toast({ title: "Delete failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: `Removed "${name}"` });
  };

  if (layout === "list") {
    return (
      <>
        <div className="card-pad stack-3">
          {visible.length === 0 ? (
            <p className="cap">No items yet.</p>
          ) : (
            visible.map((o) => (
              <div key={o.id} className="row between" style={{ alignItems: "center" }}>
                <span style={{ fontSize: 13 }}>{o.name}</span>
                <button
                  type="button"
                  className="ca"
                  onClick={() => setConfirmDelete({ id: o.id, name: o.name })}
                  title="Delete"
                  aria-label={`Delete ${o.name}`}
                >
                  <IconX className="ic ic-sm" />
                </button>
              </div>
            ))
          )}
          <AddRow
            adding={adding}
            newName={newName}
            setNewName={setNewName}
            setAdding={setAdding}
            commitAdd={commitAdd}
          />
        </div>
        <DeleteConfirm
          target={confirmDelete}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={doDelete}
        />
      </>
    );
  }

  return (
    <>
      <div className="card-pad row wrap" style={{ gap: 7, alignItems: "center" }}>
        {visible.length === 0 ? (
          <span
            className="tag"
            style={{ borderStyle: "dashed", color: "hsl(var(--subtle-foreground))" }}
          >
            No items yet
          </span>
        ) : null}
        {visible.map((o) => (
          <span
            key={o.id}
            className="tag"
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            {o.name}
            <button
              type="button"
              className="ca"
              onClick={() => setConfirmDelete({ id: o.id, name: o.name })}
              title="Delete"
              aria-label={`Delete ${o.name}`}
              style={{ marginLeft: 2 }}
            >
              <IconX className="ic" style={{ width: 9, height: 9 }} />
            </button>
          </span>
        ))}
        <AddRow
          adding={adding}
          newName={newName}
          setNewName={setNewName}
          setAdding={setAdding}
          commitAdd={commitAdd}
        />
      </div>
      <DeleteConfirm
        target={confirmDelete}
        onCancel={() => setConfirmDelete(null)}
        onConfirm={doDelete}
      />
    </>
  );
}

function AddRow({
  adding,
  newName,
  setNewName,
  setAdding,
  commitAdd,
}: {
  adding: boolean;
  newName: string;
  setNewName: (v: string) => void;
  setAdding: (v: boolean) => void;
  commitAdd: () => void;
}) {
  if (!adding) {
    return (
      <button
        type="button"
        className="tlink"
        onClick={() => setAdding(true)}
        style={{ background: "none", border: "none" }}
      >
        <IconPlus className="ic ic-sm" />
        Add
      </button>
    );
  }
  return (
    <input
      autoFocus
      className="input"
      value={newName}
      onChange={(e) => setNewName(e.target.value)}
      onBlur={commitAdd}
      onKeyDown={(e) => {
        if (e.key === "Enter") commitAdd();
        if (e.key === "Escape") {
          setNewName("");
          setAdding(false);
        }
      }}
      placeholder="New value..."
      style={{ width: 200, height: 30 }}
    />
  );
}

function DeleteConfirm({
  target,
  onCancel,
  onConfirm,
}: {
  target: { id: string; name: string } | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={Boolean(target)} onOpenChange={(open) => !open && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove "{target?.name}"?</AlertDialogTitle>
          <AlertDialogDescription>
            This deletes the value from the lookup list. Existing records that
            reference it may need to be updated by hand.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>Remove</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
