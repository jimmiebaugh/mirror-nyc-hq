import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
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
import { Switch } from "@/components/ui/switch";
import { IconLink, IconProjects, IconX } from "@/components/icons/HQIcons";
import { useClients } from "@/lib/hq/useClients";
import {
  createClientInline,
  CLIENT_MINI_CREATE_FIELDS,
  type CreatedOption,
} from "@/lib/hq/inlineCreate";
import { ClickPillCell } from "@/components/hq/ClickPillCell";
import { InlineEditText } from "@/components/hq/InlineEditText";
import { InternalNotesEditor } from "@/components/data/InternalNotesEditor";
import { RecordCombobox } from "@/components/ui/RecordCombobox";
import {
  OUTLOOK_CONFIDENCE_VALUES,
  outlookConfidenceToken,
} from "@/lib/home/projectStatusToken";
import type {
  OutlookEntry,
  OutlookConfidence,
  OutlookEntryInput,
} from "@/lib/outlook/queries";

/**
 * Outlook entry side panel (Phase 5.3 spec § 4b).
 *
 * Three states:
 *   - "detail": render kv block + actions (Promote/Unlink, Edit, Delete)
 *   - "edit":   editable form for an existing entry
 *   - "new":    editable form with empty defaults
 *
 * Inline Save / Cancel at the bottom (spec § 4b locked option 1; sticky
 * save bar pattern reserved for full-width edit pages). Card width is
 * 360px (Phase 5.6.4.1 fixup; bumped from the 277px wireframe baseline
 * after smoke-test feedback that short client names were truncating).
 * The grid-template-columns lives in OutlookPage.
 */

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const CONFIDENCE_VALUES: OutlookConfidence[] = [
  "On Radar",
  "Likely",
  "Confirmed",
  "Complete",
];

function formatBudget(b: number | null): string {
  if (b == null) return "TBD";
  return `$${b.toLocaleString("en-US")}`;
}

type PanelMode = "detail" | "edit" | "new";

export type NewEntryDefaults = {
  year: number;
  month: number;
  week: number;
};

function entryToInput(e: OutlookEntry): OutlookEntryInput {
  return {
    name: e.name,
    clientId: e.clientId,
    city: e.city,
    year: e.year,
    month: e.month,
    week: e.week,
    dateText: e.dateText,
    budget: e.budget,
    confidence: e.confidence,
    notes: e.notes,
    sharedWithTeam: e.sharedWithTeam,
  };
}

function defaultsToInput(d: NewEntryDefaults): OutlookEntryInput {
  return {
    name: "",
    clientId: null,
    city: null,
    year: d.year,
    month: d.month,
    week: d.week,
    dateText: null,
    budget: null,
    confidence: "On Radar",
    notes: null,
    sharedWithTeam: false,
  };
}

export function OutlookEntryPanel({
  mode,
  entry,
  newDefaults,
  saving,
  onClose,
  onCancelEdit,
  onSave,
  onPatch,
  onDelete,
  onPromote,
  onUnlink,
  onConfidenceChange,
}: {
  mode: PanelMode;
  /** Required for "detail" + "edit"; ignored for "new". */
  entry: OutlookEntry | null;
  /** Required for "new"; ignored for "detail" + "edit". */
  newDefaults: NewEntryDefaults | null;
  saving: boolean;
  onClose: () => void;
  onCancelEdit: () => void;
  onSave: (input: OutlookEntryInput) => Promise<void>;
  /** Single-field inline-edit patch (detail mode). */
  onPatch: (id: string, patch: Partial<OutlookEntryInput>) => Promise<void>;
  onDelete: () => Promise<void>;
  onPromote: () => Promise<void>;
  onUnlink: () => Promise<void>;
  onConfidenceChange: (id: string, next: OutlookConfidence) => Promise<void>;
}) {
  const navigate = useNavigate();
  const { options: clients } = useClients();

  // Inline-created clients are kept in local state so they're available to
  // the picker after creation. `useClients` doesn't refetch on insert and
  // the EntryPanel persists across entry switches without remounting, so
  // without this merge the freshly-added option would only show in the
  // RecordCombobox that created it and not on the next entry's picker.
  const [extraClients, setExtraClients] = useState<CreatedOption[]>([]);

  const clientOptions = useMemo(
    () => [
      ...clients.map((c) => ({ id: c.id, label: c.name })),
      ...extraClients,
    ],
    [clients, extraClients],
  );
  const loadClientOptions = useCallback(
    async () => clientOptions,
    [clientOptions],
  );

  // Form state for edit / new modes.
  const [form, setForm] = useState<OutlookEntryInput | null>(null);
  const [initial, setInitial] = useState<OutlookEntryInput | null>(null);

  useEffect(() => {
    if (mode === "edit" && entry) {
      const next = entryToInput(entry);
      setForm(next);
      setInitial(next);
    } else if (mode === "new" && newDefaults) {
      const next = defaultsToInput(newDefaults);
      setForm(next);
      setInitial(next);
    } else {
      setForm(null);
      setInitial(null);
    }
  }, [mode, entry, newDefaults]);

  const dirty = form && initial && JSON.stringify(form) !== JSON.stringify(initial);

  const [confirmCancelOpen, setConfirmCancelOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [confirmPromoteOpen, setConfirmPromoteOpen] = useState(false);
  const [confirmUnlinkOpen, setConfirmUnlinkOpen] = useState(false);

  const handleCancelEdit = () => {
    if (dirty) {
      setConfirmCancelOpen(true);
      return;
    }
    onCancelEdit();
  };

  if (mode === "detail" && entry) {
    const patch = (p: Partial<OutlookEntryInput>) => onPatch(entry.id, p);

    return (
      <aside className="card">
        <div className="card-headbar">
          <span className="h-card" style={{ fontSize: 16, flex: 1, minWidth: 0 }}>
            <InlineEditText
              value={entry.name}
              required
              placeholder="Entry name"
              renderRead={(v) => v || "(unnamed)"}
              onSave={async (v) => {
                await patch({ name: v });
              }}
            />
          </span>
          <button
            type="button"
            className="tlink"
            onClick={onClose}
            aria-label="Close panel"
          >
            <IconX className="ic" />
          </button>
        </div>
        <div className="card-pad stack-3">
          {/* Pill is left-aligned to the kv value column (104px label col +
              12px column-gap) so its left edge tracks the Month / Week /
              City / Client editable controls below. */}
          <div style={{ paddingLeft: 116 }}>
            <ClickPillCell
              value={entry.confidence}
              options={OUTLOOK_CONFIDENCE_VALUES}
              tokenMap={outlookConfidenceToken}
              onSave={async (next) => {
                await onConfidenceChange(entry.id, next as OutlookConfidence);
              }}
            />
          </div>

          <dl
            className="kv"
            style={{
              display: "grid",
              gridTemplateColumns: "104px 1fr",
              gap: "8px 12px",
            }}
          >
            <dt>Year</dt>
            <dd>
              <InlineEditText
                value={String(entry.year)}
                inputType="number"
                renderRead={(v) => v ?? "-"}
                onSave={async (v) => {
                  const n = Number(v);
                  if (!Number.isFinite(n) || n < 2024 || n > 2099) {
                    throw new Error("Year must be between 2024 and 2099.");
                  }
                  await patch({ year: n });
                }}
              />
            </dd>
            <dt>Month</dt>
            <dd>
              <select
                className="input input--filled"
                style={{ height: 28, fontSize: 13, padding: "0 8px" }}
                value={entry.month}
                onChange={async (e) => {
                  await patch({ month: Number(e.target.value) });
                }}
              >
                {MONTHS.map((m, i) => (
                  <option key={m} value={i + 1}>{m}</option>
                ))}
              </select>
            </dd>
            <dt>Week</dt>
            <dd>
              <select
                className="input input--filled"
                style={{ height: 28, fontSize: 13, padding: "0 8px" }}
                value={entry.week}
                onChange={async (e) => {
                  await patch({ week: Number(e.target.value) });
                }}
              >
                {[1, 2, 3, 4].map((w) => (
                  <option key={w} value={w}>Week {w}</option>
                ))}
              </select>
            </dd>
            <dt>City</dt>
            <dd>
              <RecordCombobox
                source={{ kind: "lookup", table: "cities" }}
                value={entry.city}
                onChange={async (v) => {
                  await patch({ city: v });
                }}
                entityLabel="City"
                placeholder="No city"
              />
            </dd>
            <dt>Date</dt>
            <dd>
              <InlineEditText
                value={entry.dateText ?? ""}
                placeholder="Early June / Jun 5 - 6"
                renderRead={(v) =>
                  v ? v : <span className="muted subtle">Not set</span>
                }
                onSave={async (v) => {
                  await patch({ dateText: v || null });
                }}
              />
            </dd>
            <dt>Budget</dt>
            <dd>
              <InlineEditText
                value={entry.budget != null ? String(entry.budget) : ""}
                inputType="number"
                placeholder="TBD"
                renderRead={(v) =>
                  v ? formatBudget(Number(v)) : (
                    <span className="muted subtle">TBD</span>
                  )
                }
                onSave={async (v) => {
                  if (v === "") {
                    await patch({ budget: null });
                    return;
                  }
                  const n = Number(v);
                  if (!Number.isFinite(n)) {
                    throw new Error("Budget must be a number.");
                  }
                  await patch({ budget: n });
                }}
              />
            </dd>
            <dt>Client</dt>
            <dd>
              <RecordCombobox
                source={{ kind: "record", loadOptions: loadClientOptions }}
                value={entry.clientId}
                onChange={async (v) => {
                  await patch({ clientId: v });
                }}
                entityLabel="Client"
                placeholder="No client"
                quickCreate
                miniCreateFields={CLIENT_MINI_CREATE_FIELDS}
                onMiniCreate={async (data) => {
                  const created = await createClientInline(data);
                  if (created) setExtraClients((prev) => [...prev, created]);
                  return created;
                }}
              />
            </dd>
            <dt>Linked Project</dt>
            <dd>
              {entry.linkedProjectId ? (
                <a
                  className="tlink"
                  onClick={() =>
                    navigate(`/projects/${entry.linkedProjectId}`)
                  }
                  style={{ cursor: "pointer" }}
                >
                  {entry.linkedProjectName ?? "View project"}
                </a>
              ) : (
                <span className="muted subtle">None</span>
              )}
            </dd>
            <dt>Shared w/ Team</dt>
            <dd>
              <Switch
                checked={entry.sharedWithTeam}
                onCheckedChange={async (v) => {
                  await patch({ sharedWithTeam: v });
                }}
              />
            </dd>
          </dl>

          <InternalNotesEditor
            parentType="outlook_entry"
            parentId={entry.id}
          />

          {/* Legacy single-text Notes column from Phase 5.3 (pre-5.6.4.1
              Internal Notes migration). Shown only when present so any
              historic content stays visible; new content goes into the
              append-only editor above. */}
          {entry.notes ? (
            <div className="stack-2">
              <span className="label-section" style={{ display: "block" }}>
                Legacy notes
              </span>
              <p
                style={{
                  fontSize: 13,
                  lineHeight: 1.45,
                  whiteSpace: "pre-wrap",
                  color: "hsl(var(--muted-foreground))",
                }}
              >
                {entry.notes}
              </p>
            </div>
          ) : null}

          <div
            className="stack-2"
            style={{
              borderTop: "1px solid hsl(var(--border))",
              paddingTop: 12,
            }}
          >
            {!entry.linkedProjectId ? (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                style={{ width: "100%" }}
                onClick={() => setConfirmPromoteOpen(true)}
              >
                <IconProjects className="ic" /> Promote to Project
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                style={{ width: "100%" }}
                onClick={() => setConfirmUnlinkOpen(true)}
              >
                <IconLink className="ic" /> Unlink Project
              </button>
            )}
            <button
              type="button"
              className="btn btn-tertiary btn-sm"
              style={{
                width: "100%",
                color: "hsl(var(--destructive))",
              }}
              onClick={() => setConfirmDeleteOpen(true)}
            >
              Delete entry
            </button>
          </div>
        </div>

        <AlertDialog open={confirmPromoteOpen} onOpenChange={setConfirmPromoteOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Promote this Outlook entry to a Project?
              </AlertDialogTitle>
              <AlertDialogDescription>
                Creates a new Project from this entry. The Project is visible
                to the whole team. This Outlook entry stays as admin-only and
                gets linked to the new Project.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={async () => {
                  await onPromote();
                  setConfirmPromoteOpen(false);
                }}
              >
                Promote
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog open={confirmUnlinkOpen} onOpenChange={setConfirmUnlinkOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Unlink this Outlook entry from its Project?
              </AlertDialogTitle>
              <AlertDialogDescription>
                Detaches the link. The Project record stays untouched and
                visible to the team.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={async () => {
                  await onUnlink();
                  setConfirmUnlinkOpen(false);
                }}
              >
                Unlink
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this Outlook entry?</AlertDialogTitle>
              <AlertDialogDescription>
                Removes the entry permanently. Any linked Project stays in
                the system, just unlinked.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={async () => {
                  await onDelete();
                  setConfirmDeleteOpen(false);
                }}
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </aside>
    );
  }

  if ((mode === "edit" || mode === "new") && form) {
    const set = <K extends keyof OutlookEntryInput>(
      key: K,
      value: OutlookEntryInput[K],
    ) => setForm((f) => (f ? { ...f, [key]: value } : f));

    const onSubmit = async () => {
      if (!form.name.trim()) return;
      await onSave(form);
    };

    const canSave =
      form.name.trim().length > 0 && (mode === "new" || !!dirty);

    return (
      <aside className="card">
        <div className="card-headbar">
          <span className="h-card" style={{ fontSize: 16 }}>
            {mode === "new" ? "New Outlook Entry" : "Edit Entry"}
          </span>
          <button
            type="button"
            className="tlink"
            onClick={handleCancelEdit}
            aria-label="Close panel"
          >
            <IconX className="ic" />
          </button>
        </div>
        <div className="card-pad stack-3">
          <div className="field">
            <label className="label-form">Name<span className="req">*</span></label>
            <input
              className={`input ${form.name ? "input--filled" : ""}`}
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="Office Refresh"
              autoFocus
            />
          </div>

          <div className="field">
            <label className="label-form">Confidence</label>
            <select
              className="input input--filled"
              value={form.confidence}
              onChange={(e) => set("confidence", e.target.value as OutlookConfidence)}
            >
              {CONFIDENCE_VALUES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          <div className="field">
            <label className="label-form">Year</label>
            <input
              className="input input--filled"
              type="number"
              min={2024}
              max={2099}
              value={form.year}
              onChange={(e) => set("year", Number(e.target.value) || form.year)}
            />
          </div>

          <div className="field">
            <label className="label-form">Month</label>
            <select
              className="input input--filled"
              value={form.month}
              onChange={(e) => set("month", Number(e.target.value))}
            >
              {MONTHS.map((m, i) => (
                <option key={m} value={i + 1}>{m}</option>
              ))}
            </select>
          </div>

          <div className="field">
            <label className="label-form">Week</label>
            <select
              className="input input--filled"
              value={form.week}
              onChange={(e) => set("week", Number(e.target.value))}
            >
              {[1, 2, 3, 4].map((w) => (
                <option key={w} value={w}>Week {w}</option>
              ))}
            </select>
          </div>

          <div className="field">
            <label className="label-form">City</label>
            <RecordCombobox
              source={{ kind: "lookup", table: "cities" }}
              value={form.city}
              onChange={(v) => set("city", v)}
              entityLabel="City"
              placeholder="No city"
            />
          </div>

          <div className="field">
            <label className="label-form">Date</label>
            <input
              className={`input ${form.dateText ? "input--filled" : ""}`}
              value={form.dateText ?? ""}
              onChange={(e) => set("dateText", e.target.value || null)}
              placeholder="Early June / Jun 5 - 6"
            />
          </div>

          <div className="field">
            <label className="label-form">Budget</label>
            <input
              className={`input ${form.budget != null ? "input--filled" : ""}`}
              type="number"
              value={form.budget ?? ""}
              onChange={(e) =>
                set(
                  "budget",
                  e.target.value === "" ? null : Number(e.target.value),
                )
              }
              placeholder="185000"
            />
          </div>

          <div className="field">
            <label className="label-form">Client</label>
            <RecordCombobox
              source={{ kind: "record", loadOptions: loadClientOptions }}
              value={form.clientId ?? null}
              onChange={(next) => set("clientId", next)}
              entityLabel="Client"
              placeholder="None"
              quickCreate
              miniCreateFields={CLIENT_MINI_CREATE_FIELDS}
              onMiniCreate={async (data) => {
                const created = await createClientInline(data);
                if (created) setExtraClients((prev) => [...prev, created]);
                return created;
              }}
            />
          </div>

          <div className="row between" style={{ alignItems: "center" }}>
            <span className="label-form" style={{ margin: 0 }}>
              Shared w/ Team
            </span>
            <Switch
              checked={form.sharedWithTeam}
              onCheckedChange={(v) => set("sharedWithTeam", v)}
            />
          </div>

          <div className="field">
            <label className="label-form">Notes</label>
            <textarea
              className={`input textarea ${form.notes ? "input--filled" : ""}`}
              value={form.notes ?? ""}
              onChange={(e) => set("notes", e.target.value || null)}
              rows={4}
              placeholder="Discovery context, ask amounts, contacts..."
            />
          </div>

          <div
            className="row between"
            style={{
              borderTop: "1px solid hsl(var(--border))",
              paddingTop: 12,
              gap: 8,
            }}
          >
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              style={{ flex: 1 }}
              onClick={handleCancelEdit}
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              style={{ flex: 1 }}
              onClick={onSubmit}
              disabled={!canSave || saving}
            >
              {saving ? "Saving..." : mode === "new" ? "Create" : "Save"}
            </button>
          </div>
        </div>

        <AlertDialog open={confirmCancelOpen} onOpenChange={setConfirmCancelOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
              <AlertDialogDescription>
                You have edits that haven't been saved. Leaving will lose them.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Stay</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  setConfirmCancelOpen(false);
                  onCancelEdit();
                }}
              >
                Discard
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </aside>
    );
  }

  // No selection / no defaults: render the "select an entry" placeholder
  // (spec § 4b alternative; wireframe always shows the panel).
  return (
    <aside className="card">
      <div className="card-pad">
        <p className="subtle" style={{ fontSize: 13 }}>
          Select an entry to see details.
        </p>
      </div>
    </aside>
  );
}
