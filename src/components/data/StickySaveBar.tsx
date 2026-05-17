import { IconArrowLeft } from "@/components/icons/HQIcons";

/**
 * Phase 5.2.1 Revision: Sticky save bar wired to the lifted `.savebar` class
 * from OUTPUTS/phase-5-hq-wireframe-v1-LOCKED.html lines 421-422 (per
 * revision spec § 1 + § 3.C). Replaces the shadcn Button + inline pattern
 * the original 5.2.1 squash shipped. Used by every HQ Core edit form.
 *
 * Phase 5.7.3 § 3.B: added the optional `onDelete` / `deleteLabel` /
 * `deleting` props. When `onDelete` is set, a destructive-tone Delete
 * button renders between Cancel and the right cluster. Consumers own the
 * confirm dialog + the actual DB delete; the bar just wires the click +
 * the disabled-while-deleting state.
 */

export function StickySaveBar({
  dirty,
  saving,
  onCancel,
  onSave,
  cancelLabel = "Cancel",
  saveLabel = "Save changes",
  onDelete,
  deleteLabel = "Delete",
  deleting = false,
}: {
  dirty: boolean;
  saving: boolean;
  onCancel: () => void;
  onSave: () => void;
  cancelLabel?: string;
  saveLabel?: string;
  onDelete?: () => void;
  deleteLabel?: string;
  deleting?: boolean;
}) {
  return (
    <div className="savebar">
      <button
        type="button"
        className="btn btn-tertiary"
        onClick={onCancel}
        disabled={saving || deleting}
      >
        <IconArrowLeft className="ic" />
        {cancelLabel}
      </button>
      {onDelete ? (
        <button
          type="button"
          className="btn btn-tertiary"
          onClick={onDelete}
          disabled={saving || deleting}
          style={{ color: "hsl(var(--destructive))", marginLeft: 4 }}
        >
          {deleting ? "Deleting..." : deleteLabel}
        </button>
      ) : null}
      <div className="row-c">
        {dirty ? <span className="dirty">Unsaved changes</span> : null}
        <button
          type="button"
          className="btn btn-primary"
          disabled={!dirty || saving || deleting}
          onClick={onSave}
        >
          {saving ? "Saving..." : saveLabel}
        </button>
      </div>
    </div>
  );
}
