import { IconArrowLeft } from "@/components/icons/HQIcons";

// Phase 5.2.1 Revision: Sticky save bar. Phase 5.13.2d: switched from
// .savebar (deleted) to .actionbar with an inner flex wrapper so the
// component owns its px-6 py-4 layout like other actionbar consumers.
// Used by every HQ Core edit form.
//
// Phase 5.7.3 § 3.B: added the optional `onDelete` / `deleteLabel` /
// `deleting` props. When `onDelete` is set, a destructive-tone Delete
// button renders between Cancel and the right cluster.

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
    <div className="actionbar">
      <div className="flex items-center justify-between gap-[14px] px-6 py-4">
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
    </div>
  );
}
