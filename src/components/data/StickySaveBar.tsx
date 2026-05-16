import { IconArrowLeft } from "@/components/icons/HQIcons";

/**
 * Phase 5.2.1 Revision: Sticky save bar wired to the lifted `.savebar` class
 * from OUTPUTS/phase-5-hq-wireframe-v1-LOCKED.html lines 421-422 (per
 * revision spec § 1 + § 3.C). Replaces the shadcn Button + inline pattern
 * the original 5.2.1 squash shipped. Used by every HQ Core edit form.
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
    <div className="savebar">
      <button type="button" className="btn btn-tertiary" onClick={onCancel}>
        <IconArrowLeft className="ic" />
        {cancelLabel}
      </button>
      <div className="row-c">
        {dirty ? <span className="dirty">Unsaved changes</span> : null}
        <button
          type="button"
          className="btn btn-primary"
          disabled={!dirty || saving}
          onClick={onSave}
        >
          {saving ? "Saving..." : saveLabel}
        </button>
      </div>
    </div>
  );
}
