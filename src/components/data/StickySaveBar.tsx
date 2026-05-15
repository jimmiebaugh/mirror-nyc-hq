import { Button } from "@/components/ui/button";

/**
 * Phase 5.2.1 canonical sticky bottom save bar, lifted from
 * `src/pages/talent-scout/RoleSettings.tsx` (the shipped Talent Scout edit
 * form). Used by every HQ Core edit form. Reference: design-system.md § 3.
 */

export function StickySaveBar({
  dirty,
  saving,
  onCancel,
  onSave,
  cancelLabel = "Cancel",
  saveLabel = "Save changes",
}: {
  dirty: boolean;
  saving: boolean;
  onCancel: () => void;
  onSave: () => void;
  cancelLabel?: string;
  saveLabel?: string;
}) {
  return (
    <div className="sticky bottom-0 z-10 -mx-6 mt-6 border-t-2 border-primary/40 bg-background/90 px-6 py-4 backdrop-blur supports-[backdrop-filter]:bg-background/75">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
        <Button variant="ghost" onClick={onCancel} type="button">
          ← {cancelLabel}
        </Button>
        <div className="flex items-center gap-3">
          {dirty ? (
            <span className="text-xs font-mono uppercase tracking-wider text-amber-400">
              Unsaved changes
            </span>
          ) : null}
          <Button onClick={onSave} disabled={saving || !dirty} type="button">
            {saving ? "Saving..." : saveLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
