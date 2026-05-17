import { useEffect, useMemo, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { RecordCombobox } from "@/components/ui/RecordCombobox";
import { useLookup, type LookupTable } from "@/lib/hq/lookups";
import { toast } from "@/hooks/use-toast";

/**
 * Mini-create modal for RecordCombobox's "+ Add" affordance (Phase 5.6.1
 * spec § 4.B). Renders a compact 2-4 field form (name + entity-specific
 * extras), awaits the parent's INSERT, surfaces a success / failure toast,
 * and lets the caller select the freshly-inserted row on success.
 *
 * Name is the only required field; Save stays disabled until it's
 * non-empty. INSERT errors do not close the modal so the user can retry
 * without retyping. No loading spinner: the writes are <100ms PostgREST
 * round trips.
 */

export type MiniCreateField = {
  key: string;
  label: string;
  required?: boolean;
  placeholder?: string;
  /** For FK selects inside the modal (e.g. Vendor category). */
  select?: { options: { id: string; label: string }[]; placeholder: string };
  /**
   * Typeahead-with-add field over a lookup table (Phase 5.6.2.1). The
   * combobox internally stores the option name, but the modal resolves
   * name -> id at submit so the parent's `onSubmit` receives the FK id
   * (same shape as the `select` variant).
   */
  lookup?: { table: LookupTable; entityLabel: string };
};

type MiniCreateModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entityLabel: string;
  fields: MiniCreateField[];
  /** Pre-fills the first (name) field from the typeahead text. */
  initialName?: string;
  onSubmit: (
    data: Record<string, string>,
  ) => Promise<{ id: string; label: string } | null>;
  onCreated?: (record: { id: string; label: string }) => void;
};

function emptyValues(fields: MiniCreateField[], initialName?: string): Record<string, string> {
  const out: Record<string, string> = {};
  fields.forEach((f, idx) => {
    out[f.key] = idx === 0 && initialName ? initialName : "";
  });
  return out;
}

export function MiniCreateModal({
  open,
  onOpenChange,
  entityLabel,
  fields,
  initialName,
  onSubmit,
  onCreated,
}: MiniCreateModalProps) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    emptyValues(fields, initialName),
  );
  const [submitting, setSubmitting] = useState(false);

  // Re-seed values whenever the modal opens.
  useEffect(() => {
    if (open) {
      setValues(emptyValues(fields, initialName));
    }
  }, [open, fields, initialName]);

  const nameKey = fields[0]?.key;
  const nameValid = nameKey ? (values[nameKey] ?? "").trim().length > 0 : false;

  const handleSave = async () => {
    if (!nameValid || submitting) return;
    setSubmitting(true);
    try {
      const trimmed: Record<string, string> = {};
      for (const f of fields) {
        trimmed[f.key] = (values[f.key] ?? "").trim();
      }
      const created = await onSubmit(trimmed);
      if (created) {
        toast({ title: `Created ${entityLabel}` });
        onCreated?.(created);
        onOpenChange(false);
      } else {
        toast({
          title: "Create failed",
          description: "Please try again.",
          variant: "destructive",
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Please try again.";
      toast({ title: "Create failed", description: message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-sm">
        <AlertDialogHeader>
          <AlertDialogTitle>New {entityLabel}</AlertDialogTitle>
        </AlertDialogHeader>
        <div className="space-y-4">
          {fields.map((f) => (
            <div key={f.key} className="space-y-2">
              <label className="label-form">
                {f.label}
                {f.required ? <span className="req">*</span> : null}
              </label>
              {f.lookup ? (
                <MiniCreateLookupField
                  table={f.lookup.table}
                  entityLabel={f.lookup.entityLabel}
                  value={values[f.key] ?? ""}
                  onChange={(next) =>
                    setValues((v) => ({ ...v, [f.key]: next }))
                  }
                />
              ) : f.select ? (
                <select
                  className="input"
                  value={values[f.key] ?? ""}
                  onChange={(e) =>
                    setValues((v) => ({ ...v, [f.key]: e.target.value }))
                  }
                >
                  <option value="">{f.select.placeholder}</option>
                  {f.select.options.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  className="input"
                  autoFocus={f.key === nameKey}
                  placeholder={f.placeholder}
                  value={values[f.key] ?? ""}
                  onChange={(e) =>
                    setValues((v) => ({ ...v, [f.key]: e.target.value }))
                  }
                />
              )}
            </div>
          ))}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={submitting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              void handleSave();
            }}
            disabled={!nameValid || submitting}
          >
            Save
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * Internal wrapper that fronts a RecordCombobox in lookup mode and
 * resolves the option name to its id at the prop boundary. Lets the
 * parent's `onSubmit` consume an FK id alongside the other free-text
 * fields without knowing the lookup table internals.
 */
function MiniCreateLookupField({
  table,
  entityLabel,
  value,
  onChange,
}: {
  table: LookupTable;
  entityLabel: string;
  value: string;
  onChange: (next: string) => void;
}) {
  const lookup = useLookup(table);
  const selectedName = useMemo(() => {
    if (!value) return null;
    return lookup.options.find((o) => o.id === value)?.name ?? null;
  }, [value, lookup.options]);

  return (
    <RecordCombobox
      source={{ kind: "lookup", table }}
      value={selectedName}
      onChange={(name) => {
        if (!name) {
          onChange("");
          return;
        }
        const opt = lookup.options.find((o) => o.name === name);
        onChange(opt?.id ?? "");
      }}
      entityLabel={entityLabel}
    />
  );
}
