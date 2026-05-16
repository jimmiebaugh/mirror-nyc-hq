import { useEffect, useRef, useState } from "react";
import { IconChevronDown } from "@/components/icons/HQIcons";
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

/**
 * Saved Views dropdown trigger. Wireframe-fidelity rebuild
 * (Phase 5.2.1 Revision); renders the `.savedviews` chip from line 993
 * of OUTPUTS/phase-5-hq-wireframe-v1-LOCKED.html.
 *
 * Carry-forward fix (code-reviewer C1 from original 5.2.1): when the user
 * picks a saved view, the component fires `onPick` AND `onNavigate` so the
 * page lands on the saved view's variant (was: filter applied, view kind
 * ignored).
 */

export function SavedViewsDropdown({
  entityType,
  activeName,
  activeViewKind,
  activeFilterState,
  onPick,
  onNavigate,
}: {
  entityType: EntityType;
  activeName: string;
  activeViewKind: ViewKind;
  activeFilterState: SavedView["filter_state"];
  onPick: (view: SavedView) => void;
  /** Optional: route to the picked view's `view_kind`. Wires SavedViews to the URL. */
  onNavigate?: (viewKind: ViewKind) => void;
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
      setViews((vs) =>
        [...vs, v].sort((a, b) => a.name.localeCompare(b.name)),
      );
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
    <div style={{ position: "relative" }} ref={popoverRef}>
      <span
        className="savedviews"
        role="button"
        onClick={() => setOpen((v) => !v)}
      >
        <IconChevronDown className="ic" style={{ width: 12, height: 12 }} />
        {activeName}
      </span>
      {open ? (
        <div
          className="card"
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            zIndex: 30,
            width: 240,
            padding: 6,
          }}
        >
          {views.length === 0 ? (
            <div
              className="cap"
              style={{ padding: "8px 10px" }}
            >
              No saved views yet
            </div>
          ) : (
            views.map((v) => (
              <div
                key={v.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                  padding: "6px 8px",
                  borderRadius: 4,
                }}
              >
                <button
                  type="button"
                  className="tlink"
                  style={{
                    flex: 1,
                    justifyContent: "flex-start",
                    color: "hsl(var(--foreground))",
                    fontSize: 12,
                  }}
                  onClick={() => {
                    onPick(v);
                    if (onNavigate) onNavigate(v.view_kind);
                    setOpen(false);
                  }}
                >
                  {v.name}
                  {v.is_default ? (
                    <span
                      style={{
                        marginLeft: 8,
                        fontSize: 9,
                        textTransform: "uppercase",
                        letterSpacing: ".06em",
                        color: "hsl(var(--primary))",
                      }}
                    >
                      default
                    </span>
                  ) : null}
                </button>
                <button
                  type="button"
                  className="tlink"
                  style={{
                    color: "hsl(var(--subtle-foreground))",
                    fontSize: 11,
                  }}
                  onClick={() => handleDelete(v.id)}
                  aria-label={`Delete ${v.name}`}
                >
                  ×
                </button>
              </div>
            ))
          )}
          <div
            style={{
              borderTop: "1px solid hsl(var(--border))",
              marginTop: 4,
              paddingTop: 4,
            }}
          >
            <button
              type="button"
              className="tlink"
              style={{ padding: "6px 8px", fontSize: 11 }}
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
              Capture the active filters and view kind so you can come back to
              them later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="stack-3">
            <div className="field">
              <label className="label-form" htmlFor="saved-view-name">
                Name
              </label>
              <input
                id="saved-view-name"
                className="input"
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                placeholder="Active projects"
                autoFocus
              />
            </div>
            <label
              className="cap"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                color: "hsl(var(--foreground))",
                fontSize: 13,
              }}
            >
              <input
                type="checkbox"
                checked={draftDefault}
                onChange={(e) => setDraftDefault(e.target.checked)}
              />
              Make this my default view
            </label>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleSave}
              disabled={!draftName.trim()}
            >
              Save
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
