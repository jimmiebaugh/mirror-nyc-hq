import { useEffect, useRef, useState } from "react";
import type { FilterState } from "@/components/data/FilterBar";
import {
  createSavedView,
  deleteSavedView,
  listSavedViews,
  type EntityType,
  type SavedView,
  type ViewKind,
} from "@/lib/hq/savedViews";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";

/**
 * Saved Views dropdown trigger. Renders the current view name + a chevron;
 * opens a popover listing every saved view for the (user, entity) pair
 * with a "+ Save current view" affordance.
 *
 * Spec: § 5.A.1 component contract.
 */

export function SavedViewsDropdown({
  entityType,
  activeName,
  activeViewKind,
  activeFilterState,
  onPick,
}: {
  entityType: EntityType;
  activeName: string;
  activeViewKind: ViewKind;
  activeFilterState: FilterState;
  onPick: (view: SavedView) => void;
}) {
  const [open, setOpen] = useState(false);
  const [views, setViews] = useState<SavedView[]>([]);
  const [saveOpen, setSaveOpen] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftDefault, setDraftDefault] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    listSavedViews(entityType)
      .then((rows) => {
        if (active) setViews(rows);
      })
      .catch(() => {
        if (active) setViews([]);
      });
    return () => {
      active = false;
    };
  }, [entityType]);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!popoverRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const handleSave = async () => {
    if (!draftName.trim()) return;
    try {
      const v = await createSavedView({
        entityType,
        name: draftName.trim(),
        viewKind: activeViewKind,
        filterState: activeFilterState,
        isDefault: draftDefault,
      });
      setViews((vs) => [...vs, v].sort((a, b) => a.name.localeCompare(b.name)));
      setSaveOpen(false);
      setDraftName("");
      setDraftDefault(false);
    } catch (err) {
      console.error("saved view create failed", err);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteSavedView(id);
      setViews((vs) => vs.filter((v) => v.id !== id));
    } catch (err) {
      console.error("saved view delete failed", err);
    }
  };

  return (
    <div className="relative" ref={popoverRef}>
      <button
        type="button"
        className="hq-savedview-btn"
        onClick={() => setOpen((v) => !v)}
      >
        <span>{activeName}</span>
        <span aria-hidden>▾</span>
      </button>
      {open ? (
        <div className="absolute left-0 top-full z-30 mt-1 w-64 rounded-md border border-[hsl(var(--border-strong))] bg-[hsl(var(--surface-raised))] p-1 shadow-lg">
          {views.length === 0 ? (
            <div className="px-3 py-2 text-[12px] text-[hsl(var(--subtle-foreground))] font-mono">
              No saved views yet
            </div>
          ) : (
            views.map((v) => (
              <div
                key={v.id}
                className="flex items-center justify-between gap-2 rounded px-2 py-1.5 hover:bg-[hsl(var(--surface-alt))]"
              >
                <button
                  type="button"
                  className="flex-1 text-left text-[13px]"
                  onClick={() => {
                    onPick(v);
                    setOpen(false);
                  }}
                >
                  {v.name}
                  {v.is_default ? (
                    <span className="ml-2 text-[10px] uppercase tracking-wider text-primary">
                      default
                    </span>
                  ) : null}
                </button>
                <button
                  type="button"
                  className="text-[12px] text-[hsl(var(--subtle-foreground))] hover:text-[hsl(var(--destructive))]"
                  onClick={() => handleDelete(v.id)}
                  aria-label={`Delete ${v.name}`}
                >
                  ✕
                </button>
              </div>
            ))
          )}
          <div className="border-t border-[hsl(var(--border))] mt-1 pt-1">
            <button
              type="button"
              className="w-full px-2 py-1.5 text-left text-[12px] text-primary hover:bg-[hsl(var(--surface-alt))]"
              onClick={() => {
                setOpen(false);
                setSaveOpen(true);
              }}
            >
              + Save current view
            </button>
          </div>
        </div>
      ) : null}

      <AlertDialog open={saveOpen} onOpenChange={setSaveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Save view</AlertDialogTitle>
            <AlertDialogDescription>
              Capture the active filters and view kind so you can come back
              to them later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="saved-view-name">Name</Label>
              <Input
                id="saved-view-name"
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                placeholder="Active projects"
                autoFocus
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={draftDefault}
                onCheckedChange={(v) => setDraftDefault(v === true)}
              />
              Make this my default view
            </label>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleSave} disabled={!draftName.trim()}>
              Save
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
