import { useEffect, useState } from "react";
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
import { useLookup } from "@/lib/hq/lookups";
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
 * save bar pattern reserved for full-width edit pages). 277px width
 * matches the wireframe.
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
  onBeginEdit,
  onCancelEdit,
  onSave,
  onDelete,
  onPromote,
  onUnlink,
}: {
  mode: PanelMode;
  /** Required for "detail" + "edit"; ignored for "new". */
  entry: OutlookEntry | null;
  /** Required for "new"; ignored for "detail" + "edit". */
  newDefaults: NewEntryDefaults | null;
  saving: boolean;
  onClose: () => void;
  onBeginEdit: () => void;
  onCancelEdit: () => void;
  onSave: (input: OutlookEntryInput) => Promise<void>;
  onDelete: () => Promise<void>;
  onPromote: () => Promise<void>;
  onUnlink: () => Promise<void>;
}) {
  const navigate = useNavigate();
  const { options: clients } = useClients();
  const { options: cityOptions } = useLookup("cities");

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
    return (
      <aside className="card">
        <div className="card-headbar">
          <span className="h-card" style={{ fontSize: 16 }}>
            {entry.name}
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
          <div>
            <span
              className={`pill p-${confidenceToken(entry.confidence)}`}
            >
              <span className="dt" />
              {entry.confidence}
            </span>
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
            <dd>{entry.year}</dd>
            <dt>Month</dt>
            <dd>{MONTHS[entry.month - 1]}</dd>
            <dt>Week</dt>
            <dd>{`Week ${entry.week}`}</dd>
            <dt>City</dt>
            <dd>
              {entry.city ? (
                <span className="tag">{entry.city}</span>
              ) : (
                <span className="muted subtle">None</span>
              )}
            </dd>
            <dt>Date</dt>
            <dd>
              {entry.dateText || (
                <span className="muted subtle">Not set</span>
              )}
            </dd>
            <dt>Budget</dt>
            <dd>
              {entry.budget != null ? (
                formatBudget(entry.budget)
              ) : (
                <span className="muted subtle">TBD</span>
              )}
            </dd>
            <dt>Client</dt>
            <dd>
              {entry.clientId ? (
                <a
                  className="tlink"
                  onClick={() => navigate(`/clients/${entry.clientId}`)}
                  style={{ cursor: "pointer" }}
                >
                  {entry.clientName ?? "View client"}
                </a>
              ) : (
                <span className="muted subtle">None</span>
              )}
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
              {entry.sharedWithTeam ? "Yes" : "No"}
            </dd>
          </dl>

          {entry.notes ? (
            <div className="stack-2">
              <span className="label-section">Notes</span>
              <p
                style={{
                  fontSize: 13,
                  lineHeight: 1.45,
                  whiteSpace: "pre-wrap",
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
              className="btn btn-secondary btn-sm"
              style={{ width: "100%" }}
              onClick={onBeginEdit}
            >
              Edit Entry
            </button>
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
            <select
              className={`input ${form.city ? "input--filled" : ""}`}
              value={form.city ?? ""}
              onChange={(e) => set("city", e.target.value || null)}
            >
              <option value="">None</option>
              {cityOptions.map((c) => (
                <option key={c.id} value={c.name}>{c.name}</option>
              ))}
            </select>
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
            <select
              className={`input ${form.clientId ? "input--filled" : ""}`}
              value={form.clientId ?? ""}
              onChange={(e) => set("clientId", e.target.value || null)}
            >
              <option value="">None</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
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

function confidenceToken(c: OutlookConfidence): string {
  switch (c) {
    case "On Radar":  return "warn";
    case "Likely":    return "info";
    case "Confirmed": return "success";
    case "Complete":  return "muted";
  }
}
