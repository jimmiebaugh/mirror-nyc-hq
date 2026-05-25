// Phase 5.12.14.3 Round 2 amendment v4: `label` prop widens from required
// `string` to optional `string | ReactNode`. Optional supports the Dates
// sub-section where the section header doubles as the field label (no
// per-row label needed). ReactNode supports the Neighborhoods row's
// "Neighborhoods *STRICT" inline marker (amendment v4 § 3).
//
// Amendment v3: blank-state placeholder flips "Not provided" -> "-"
// (single hyphen) for less visual weight on the new one-sheet BriefReport
// layout. New optional `editorLeftActions` slot renders in the edit-mode
// button row, left of Cancel/Save (used by the Neighborhoods row's
// Strict? checkbox per amendment v3 § C).
//
// Round 2 amendment v2: outer `.card-pad` dropped; the row is now a
// neutral block with `space-y-2` rhythm only. Parent section card owns
// the surrounding padding via `.card-pad stack-4`. Label class flipped
// `.label-section` -> `.label-form` (per design-system § 3: per-field
// labels inside section cards are `.label-form`).
//
// Round 1 history: renamed from BriefReportCard; stripped per-row Card
// chrome (rounded border + bg-surface-alt + p-4) introduced in 5.12.14.
//
// Click anywhere to flip to edit mode; Save commits, Cancel reverts to
// the last saved value, Escape cancels. The blank state ("-") still
// flips to edit mode on click.
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function BriefReportRow<T>({
  label,
  value,
  isBlank,
  renderDisplay,
  renderEditor,
  editorLeftActions,
  onSave,
  disabled,
}: {
  label?: string | React.ReactNode;
  value: T;
  isBlank: (v: T) => boolean;
  renderDisplay: (v: T) => React.ReactNode;
  renderEditor: (draft: T, setDraft: (v: T) => void) => React.ReactNode;
  // Phase 5.12.14.3 amendment v3 § D: optional left-side actions in the
  // editor's button row. Sits flex-justified-between with Cancel/Save on
  // the right. Used today by Neighborhoods' Strict? checkbox.
  editorLeftActions?: (draft: T, setDraft: (v: T) => void) => React.ReactNode;
  onSave: (v: T) => void;
  disabled?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<T>(value);

  // R6 § M.6: sync draft <- value when the parent updates the source row
  // OUTSIDE an edit session. The original `useState(value)` only seeded
  // draft on mount, so external changes (a sibling card edit, an async
  // generate) wouldn't propagate into this row's display state. Guarding
  // on `!editing` keeps the producer's in-flight typing intact.
  useEffect(() => {
    if (!editing) {
      setDraft(value);
    }
  }, [value, editing]);

  const enter = () => {
    if (disabled || editing) return;
    setDraft(value);
    setEditing(true);
  };
  const commit = () => {
    onSave(draft);
    setEditing(false);
  };
  const cancel = () => setEditing(false);

  return (
    <div
      className={cn(
        "space-y-2",
        !editing && !disabled && "cursor-pointer",
      )}
      data-brief-row
      onClick={!editing ? enter : undefined}
      onKeyDown={
        editing
          ? (e) => {
              // R6 § M.5: skip cancel() when a child component already
              // consumed the Escape key (Radix Popover / Combobox call
              // preventDefault to close their own UI). Without this guard
              // pressing Escape inside a Combobox dismissed both the
              // popover AND the surrounding row editor in one shot.
              if (e.key === "Escape" && !e.defaultPrevented) cancel();
            }
          : undefined
      }
    >
      {label != null && label !== "" && (
        <div className="label-form">{label}</div>
      )}
      {editing ? (
        <div className="space-y-3" onClick={(e) => e.stopPropagation()}>
          {renderEditor(draft, setDraft)}
          <div className="flex items-center justify-between gap-2">
            <div>{editorLeftActions?.(draft, setDraft)}</div>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={cancel}>
                Cancel
              </Button>
              <Button size="sm" onClick={commit}>
                Save
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="text-sm">
          {isBlank(value) ? (
            <span className="italic text-muted-foreground/60">-</span>
          ) : (
            renderDisplay(value)
          )}
        </div>
      )}
    </div>
  );
}
