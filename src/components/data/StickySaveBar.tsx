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
      {/* Phase 6.5 follow-up: 3-zone actionbar. Cancel (discard/exit, no
          back-arrow -- the arrow is reserved for step-back navigation) sits far
          left; any secondary action (Delete) is truly centered via the
          1fr/auto/1fr grid; the Save cluster sits far right. */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-[14px] px-6 py-4">
        <div className="justify-self-start">
          <button
            type="button"
            className="btn btn-tertiary"
            onClick={onCancel}
            disabled={saving || deleting}
          >
            {cancelLabel}
          </button>
        </div>
        <div className="justify-self-center">
          {onDelete ? (
            <button
              type="button"
              className="btn btn-tertiary"
              onClick={onDelete}
              disabled={saving || deleting}
              style={{ color: "hsl(var(--destructive))" }}
            >
              {deleting ? "Deleting..." : deleteLabel}
            </button>
          ) : null}
        </div>
        <div className="row-c justify-self-end">
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
