import { useEffect, useRef, useState } from "react";
import { IconChevronDown } from "@/components/icons/HQIcons";
import { useUserRole } from "@/hooks/useUserRole";
import { toast } from "@/hooks/use-toast";
import {
  createSavedView,
  deleteSavedView,
  hasGlobalDefault,
  listSavedViews,
  resetUserDefault,
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
 * Phase 5.6.5 additions:
 *   - Save dialog: owner-only "Save as default for all users" checkbox.
 *     When ticked, writes a `scope='global', is_default=true` row visible
 *     to every authenticated user. Mutually exclusive with the per-user
 *     default checkbox (the per-user option hides while the global option
 *     is ticked).
 *   - Dropdown: "Reset to global default" item, visible when the user
 *     has a per-user default for this entity AND a global default
 *     exists. Calls `resetUserDefault` then fires the new
 *     `onResetToGlobal` callback so the parent re-resolves.
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
  onResetToGlobal,
}: {
  entityType: EntityType;
  activeName: string;
  activeViewKind: ViewKind;
  activeFilterState: SavedView["filter_state"];
  onPick: (view: SavedView) => void;
  /** Optional: route to the picked view's `view_kind`. Wires SavedViews to the URL. */
  onNavigate?: (viewKind: ViewKind) => void;
  /**
   * Phase 5.6.5. Fires after a successful `resetUserDefault` so the
   * parent can re-run its default-view resolution and apply the global
   * default (or fall back to the empty state) without a page reload.
   */
  onResetToGlobal?: () => void;
}) {
  const { isOwner } = useUserRole();
  const [open, setOpen] = useState(false);
  const [views, setViews] = useState<SavedView[]>([]);
  const [saveOpen, setSaveOpen] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftDefault, setDraftDefault] = useState(false);
  const [draftGlobal, setDraftGlobal] = useState(false);
  const [showResetToGlobal, setShowResetToGlobal] = useState(false);
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

  // Resolve "Reset to global default" visibility when the dropdown opens.
  // Two checks: does the user have a per-user default AND does a global
  // default exist for this entity_type. Both must be true to render.
  useEffect(() => {
    if (!open) return;
    let active = true;
    Promise.all([
      listSavedViews(entityType).then((vs) =>
        vs.some((v) => v.scope === "user" && v.is_default),
      ),
      hasGlobalDefault(entityType),
    ])
      .then(([hasUserDefault, hasGlobal]) => {
        if (active) setShowResetToGlobal(hasUserDefault && hasGlobal);
      })
      .catch(() => {
        if (active) setShowResetToGlobal(false);
      });
    return () => {
      active = false;
    };
  }, [open, entityType]);

  const handleSave = async () => {
    if (!draftName.trim()) return;
    try {
      // `draftGlobal` overrides the per-user default checkbox (the two
      // are mutually exclusive in the UI). A global view that's not the
      // global default is meaningless, so force is_default true.
      const useGlobal = draftGlobal && isOwner;
      const v = await createSavedView({
        entityType,
        name: draftName.trim(),
        viewKind: activeViewKind,
        filterState: activeFilterState,
        isDefault: useGlobal ? true : draftDefault,
        scope: useGlobal ? "global" : "user",
      });
      setViews((vs) =>
        [...vs, v].sort((a, b) => a.name.localeCompare(b.name)),
      );
      setSaveOpen(false);
      setDraftName("");
      setDraftDefault(false);
      setDraftGlobal(false);
      toast({
        title: useGlobal ? "Saved global default" : "Saved view",
      });
    } catch (err) {
      console.error("saved view create failed", err);
      toast({ title: "Save failed", variant: "destructive" });
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

  const handleResetToGlobal = async () => {
    try {
      await resetUserDefault(entityType);
      setOpen(false);
      setShowResetToGlobal(false);
      // Re-fetch the row list so the cleared per-user default reflects
      // in the dropdown the next time it opens.
      listSavedViews(entityType).then((rows) => setViews(rows)).catch(() => {});
      toast({ title: "Reset to global default" });
      onResetToGlobal?.();
    } catch (err) {
      console.error("reset to global failed", err);
      toast({ title: "Reset failed", variant: "destructive" });
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
                        color: "hsl(var(--subtle-foreground))",
                      }}
                    >
                      {v.scope === "global" ? "global default" : "default"}
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
          {showResetToGlobal ? (
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
                onClick={handleResetToGlobal}
              >
                Reset to global default
              </button>
            </div>
          ) : null}
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
            {!draftGlobal ? (
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
            ) : null}
            {isOwner ? (
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
                  checked={draftGlobal}
                  onChange={(e) => setDraftGlobal(e.target.checked)}
                />
                Save as default for all users
              </label>
            ) : null}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => {
                setDraftName("");
                setDraftDefault(false);
                setDraftGlobal(false);
              }}
            >
              Cancel
            </AlertDialogCancel>
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
