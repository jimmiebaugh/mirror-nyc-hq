import { useRef, useState } from "react";
import { IconX } from "@/components/icons/HQIcons";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { LookupOption } from "@/lib/hq/lookups";

/**
 * Multi-tag input with inline-add (Phase 5.2.2 § 6.C). Used for
 * Organization Capabilities (Vendor/Internal only). Values bind as a
 * `string[]` of names; the lookup table seeds the picker options.
 *
 * Wireframe ref: render as a row of `.tag` chips with an `x` per tag for
 * removal, followed by a small select for adding from the option list +
 * an "+ Add new..." sentinel that opens an AlertDialog.
 */

export function MultiTagInput({
  options,
  values,
  onChange,
  onAdd,
  entityLabel,
  exampleName,
  placeholder = "Add...",
}: {
  options: LookupOption[];
  values: string[];
  onChange: (next: string[]) => void;
  onAdd: (name: string) => Promise<LookupOption | null>;
  entityLabel: string;
  exampleName?: string;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const remove = (v: string) => {
    onChange(values.filter((x) => x !== v));
  };

  const add = (v: string) => {
    if (!v || values.includes(v)) return;
    onChange([...values, v]);
  };

  const available = options.filter((o) => !values.includes(o.name));

  return (
    <>
      <div className="row-c wrap" style={{ gap: 6 }}>
        {values.map((v) => (
          <span key={v} className="tag" style={{ display: "inline-flex", gap: 5, alignItems: "center" }}>
            {v}
            <button
              type="button"
              aria-label={`Remove ${v}`}
              onClick={() => remove(v)}
              style={{
                background: "transparent",
                border: 0,
                cursor: "pointer",
                color: "inherit",
                padding: 0,
                display: "inline-flex",
              }}
            >
              <IconX className="ic" style={{ width: 10, height: 10 }} />
            </button>
          </span>
        ))}
        <select
          className="input"
          style={{ height: 32, fontSize: 12, padding: "4px 8px" }}
          value=""
          onChange={(e) => {
            if (!e.target.value) return;
            if (e.target.value === "__add_new__") {
              setOpen(true);
            } else {
              add(e.target.value);
            }
          }}
        >
          <option value="">{placeholder}</option>
          {available.map((o) => (
            <option key={o.id} value={o.name}>
              {o.name}
            </option>
          ))}
          <option value="__add_new__">+ Add new...</option>
        </select>
      </div>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Add a new {entityLabel}</AlertDialogTitle>
          </AlertDialogHeader>
          <input
            ref={inputRef}
            className="input"
            autoFocus
            placeholder={exampleName ? `e.g. ${exampleName}` : ""}
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                const name = inputRef.current?.value.trim() ?? "";
                if (!name) return;
                const added = await onAdd(name);
                if (added) {
                  add(added.name);
                  setOpen(false);
                }
              }}
            >
              Add
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
