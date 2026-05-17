import { useEffect, useRef, useState } from "react";
import { toast } from "@/hooks/use-toast";

/**
 * Click-to-edit text field for the inline-edit-on-detail-pages pattern
 * (Phase 5.6.3). Two display modes:
 *
 *   - **read mode**: renders the current value via a render prop (so the
 *     caller controls whether the value is a `<span>`, a `<Link>`, an
 *     `<a href="mailto:">`, an `<h1 className="h-page">`, etc.). Hover
 *     shows a subtle underline + cursor:text affordance.
 *   - **edit mode**: replaces the read render with an `<input>` (or
 *     `<textarea>` when `multiline`). Save fires on blur OR Enter; Esc
 *     reverts without saving.
 *
 * Save shape: caller provides `onSave(next)` which performs the DB
 * UPDATE for that single field. The primitive handles optimistic UI
 * (local value updates immediately, dispatches save in background) and
 * rollback on error (reverts local value, destructive toast).
 *
 * Required fields: pass `required`. Empty input on save is blocked with
 * a toast and stays in edit mode so the user can retry without losing
 * their cursor.
 *
 * Locked decisions for 5.6.3 (from the plan § 3.E open questions, set
 * as defaults pending Jimmie's review):
 *   - Required-field empty → block + toast, stay in edit mode
 *   - Concurrent edit / Realtime conflict → last-write-wins, no UI
 *   - Visual affordance → hover underline, cursor:text on hover
 *   - Cancel / undo → Esc reverts to last-saved value
 */

export type InlineEditTextProps = {
  value: string | null;
  /** Render the read-mode display from the current value. */
  renderRead: (value: string | null) => React.ReactNode;
  /** Save the new value to the DB. Throws on failure. */
  onSave: (next: string) => Promise<void>;
  /** Placeholder shown in edit mode when value is empty. */
  placeholder?: string;
  /** Empty-input save blocked + toast; required asterisk shown on hover. */
  required?: boolean;
  /** Render as <textarea> instead of <input>. */
  multiline?: boolean;
  /** Optional value transform on blur (e.g. phone formatter). */
  onBlurFormat?: (raw: string) => string;
  /** Optional input type (e.g. "email", "url"). Ignored when multiline. */
  inputType?: string;
};

export function InlineEditText({
  value,
  renderRead,
  onSave,
  placeholder,
  required,
  multiline,
  onBlurFormat,
  inputType = "text",
}: InlineEditTextProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  // Re-sync draft when external value changes (Realtime / parent re-fetch).
  useEffect(() => {
    if (!editing) setDraft(value ?? "");
  }, [value, editing]);

  // Focus + select on enter-edit. For native date / time / datetime inputs,
  // also pop the browser picker so the user doesn't need a second click.
  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      if ("setSelectionRange" in inputRef.current) {
        const len = inputRef.current.value.length;
        try {
          inputRef.current.setSelectionRange(len, len);
        } catch {
          // setSelectionRange throws on some input types (email, url); safe to ignore.
        }
      }
      if (
        inputType === "date" ||
        inputType === "time" ||
        inputType === "datetime-local" ||
        inputType === "month" ||
        inputType === "week"
      ) {
        const el = inputRef.current as HTMLInputElement;
        if (typeof el.showPicker === "function") {
          try {
            el.showPicker();
          } catch {
            // Some browsers throw if showPicker is called without a user
            // gesture; the click that flipped editing→true counts, but
            // strictness varies. Safe to ignore — the input still has focus.
          }
        }
      }
    }
  }, [editing, inputType]);

  const commit = async () => {
    const formatted = onBlurFormat ? onBlurFormat(draft) : draft;
    const trimmed = multiline ? formatted : formatted.trim();
    if (trimmed === (value ?? "")) {
      // No change → just exit edit mode silently.
      setEditing(false);
      setDraft(value ?? "");
      return;
    }
    if (required && trimmed.length === 0) {
      toast({
        title: "This field is required",
        description: "Empty value not saved. Esc to cancel.",
        variant: "destructive",
      });
      // Stay in edit mode so the user can fix without losing position.
      return;
    }
    setSaving(true);
    try {
      await onSave(trimmed);
      setDraft(trimmed);
      setEditing(false);
    } catch (err) {
      // Revert + toast. Stay out of edit mode so the user can retry by
      // clicking again (avoids trapping them in a broken edit state).
      setDraft(value ?? "");
      setEditing(false);
      const message = err instanceof Error ? err.message : "Save failed";
      toast({ title: "Save failed", description: message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const cancel = () => {
    setDraft(value ?? "");
    setEditing(false);
  };

  if (!editing) {
    return (
      <span
        role="button"
        tabIndex={0}
        className="inline-edit-read"
        title="Click to edit"
        onClick={() => setEditing(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setEditing(true);
          }
        }}
      >
        {renderRead(value)}
      </span>
    );
  }

  const commonProps = {
    ref: inputRef as React.RefObject<HTMLInputElement & HTMLTextAreaElement>,
    value: draft,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setDraft(e.target.value),
    onBlur: () => {
      if (!saving) void commit();
    },
    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (e.key === "Escape") {
        e.preventDefault();
        cancel();
      } else if (!multiline && e.key === "Enter") {
        e.preventDefault();
        void commit();
      } else if (multiline && e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        // Cmd/Ctrl+Enter saves multiline.
        e.preventDefault();
        void commit();
      }
    },
    placeholder,
    disabled: saving,
    className: "input inline-edit-input",
    style: { minHeight: multiline ? 80 : undefined },
  };

  return multiline ? (
    <textarea {...commonProps} rows={3} />
  ) : (
    <input {...commonProps} type={inputType} />
  );
}
