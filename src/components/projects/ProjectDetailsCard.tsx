// Phase 5.16.1.1 §3b (code-observations Frontend #19): presentational split
// of ProjectDetail. This is the "Details" card body. All data + callbacks
// arrive via props; every hook, query, optimistic-update sequence, and dep
// array stays in the parent ProjectDetail.tsx. JSX only relocated here.
import type { Dispatch, SetStateAction } from "react";
import { DField } from "@/components/hq/DField";
import { InlineEditText } from "@/components/hq/InlineEditText";
import { RecordCombobox } from "@/components/ui/RecordCombobox";
import { DateField } from "@/components/ui/DateField";
import {
  createClientInline,
  createVenueInline,
  CLIENT_MINI_CREATE_FIELDS,
} from "@/lib/hq/inlineCreate";
import type { Project } from "@/pages/projects/ProjectDetail";

function formatBudget(b: number | null): string {
  if (b == null) return "-";
  return `$${b.toLocaleString("en-US")}`;
}

export function ProjectDetailsCard({
  project,
  venueIds,
  saveField,
  saveFields,
  saveClientId,
  saveVenueIds,
  loadClientOptions,
  loadVenueOptions,
  setClientOptions,
  setVenueOptions,
}: {
  project: Project;
  venueIds: string[];
  saveField: <K extends keyof Project>(field: K, nextValue: Project[K]) => Promise<void>;
  saveFields: (patch: Partial<Project>) => Promise<void>;
  saveClientId: (nextId: string | null) => Promise<void>;
  saveVenueIds: (nextIds: string[]) => Promise<void>;
  loadClientOptions: () => Promise<{ id: string; label: string }[]>;
  loadVenueOptions: () => Promise<{ id: string; label: string }[]>;
  setClientOptions: Dispatch<SetStateAction<{ id: string; label: string }[]>>;
  setVenueOptions: Dispatch<SetStateAction<{ id: string; label: string }[]>>;
}) {
  return (
    <section className="card">
      <div className="card-headbar">
        <span className="h-card">Details</span>
      </div>
      <div className="card-pad stack-4">
        {/* Phase 5.11.3: Job# | Category | Budget (3-col), Title |
            Client, City | Venue, then the Live / Install / Removal
            date trio. Tags moved to its own full-width row at the
            bottom under a divider. */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: 16,
          }}
        >
          <DField label="Job #">
            <InlineEditText
              value={project.job_number}
              placeholder="Job number"
              renderRead={(v) =>
                v ? <span className="mono">#{v}</span> : <span className="muted subtle">-</span>
              }
              onSave={(next) => saveField("job_number", next || null)}
            />
          </DField>
          <DField label="Category">
            <RecordCombobox
              source={{ kind: "lookup", table: "project_categories" }}
              value={project.category || null}
              onChange={(next) => void saveField("category", next || null)}
              entityLabel="Category"
              placeholder="Select"
            />
          </DField>
          <DField label="Budget">
            <InlineEditText
              value={project.budget != null ? String(project.budget) : null}
              placeholder="$185,000"
              renderRead={(v) =>
                v ? formatBudget(Number(v)) : <span className="muted subtle">-</span>
              }
              onSave={(next) => {
                const parsed = next ? Number(next.replace(/[$,\s]/g, "")) : null;
                return saveField(
                  "budget",
                  parsed != null && Number.isFinite(parsed) ? parsed : null,
                );
              }}
            />
          </DField>
        </div>
        <div style={{ borderTop: "1px solid hsl(var(--border))" }} />
        <div className="g2">
          <DField label="Title">
            <InlineEditText
              value={project.name}
              required
              placeholder="Project name"
              renderRead={(v) => v ?? "(untitled)"}
              onSave={(next) => saveField("name", next)}
            />
          </DField>
          <DField label="Client">
            <RecordCombobox
              source={{ kind: "record", loadOptions: loadClientOptions }}
              value={project.client_id}
              onChange={(next) => void saveClientId(next)}
              entityLabel="Client"
              placeholder="No client"
              quickCreate
              getRecordHref={(id) => `/clients/${id}`}
              miniCreateFields={CLIENT_MINI_CREATE_FIELDS}
              onMiniCreate={async (data) => {
                const created = await createClientInline(data);
                if (created) {
                  setClientOptions((prev) =>
                    [...prev, created].sort((a, b) =>
                      a.label.localeCompare(b.label),
                    ),
                  );
                }
                return created;
              }}
            />
          </DField>
        </div>
        <div style={{ borderTop: "1px solid hsl(var(--border))" }} />
        <div className="g2">
          <DField label="City">
            <RecordCombobox
              source={{ kind: "lookup", table: "cities" }}
              value={project.city || null}
              onChange={(next) => void saveField("city", next || null)}
              entityLabel="city"
              placeholder="Select"
            />
          </DField>
          <DField label="Venue">
            <RecordCombobox
              multi
              source={{ kind: "record", loadOptions: loadVenueOptions }}
              multiValue={venueIds}
              onMultiChange={(next) => void saveVenueIds(next)}
              entityLabel="Venue"
              placeholder="Add venue..."
              // Venue create is single-field (name only), so it adds immediately
              // on Enter / "+ Add" with no modal (Phase 6.5 follow-up):
              // createVenueInline only needs { name }.
              quickCreate
              getRecordHref={(id) => `/venues/${id}`}
              displayAs="stack"
              onMiniCreate={async (data) => {
                const created = await createVenueInline(data);
                if (created) {
                  setVenueOptions((prev) =>
                    [...prev, created].sort((a, b) =>
                      a.label.localeCompare(b.label),
                    ),
                  );
                }
                return created;
              }}
            />
          </DField>
        </div>
        <div style={{ borderTop: "1px solid hsl(var(--border))" }} />
        {/* Phase 6.3 (P8): Live | Install | Removal, each one single-or-range
            DateField over its start/end pair, committed atomically via
            saveFields. Vertical dividers kept; the per-field arrangement
            restructure (P7) is the LAYOUT cluster, not 6.3. */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 0 }}>
          <div className="field" style={{ gap: 4 }}>
            <div className="label-form">Live</div>
            <DateField
              variant="inline"
              value={{ start: project.live_dates_start, end: project.live_dates_end }}
              onChange={(v) =>
                void saveFields({ live_dates_start: v.start, live_dates_end: v.end })
              }
              placeholder="Not set"
            />
          </div>
          <div
            className="field"
            style={{
              gap: 4,
              borderLeft: "1px solid hsl(var(--border))",
              paddingLeft: 16,
              marginLeft: 16,
            }}
          >
            <div className="label-form">Install</div>
            <DateField
              variant="inline"
              value={{ start: project.install_dates_start, end: project.install_dates_end }}
              onChange={(v) =>
                void saveFields({ install_dates_start: v.start, install_dates_end: v.end })
              }
              placeholder="Not set"
            />
          </div>
          <div
            className="field"
            style={{
              gap: 4,
              borderLeft: "1px solid hsl(var(--border))",
              paddingLeft: 16,
              marginLeft: 16,
            }}
          >
            <div className="label-form">Removal</div>
            <DateField
              variant="inline"
              value={{ start: project.removal_dates_start, end: project.removal_dates_end }}
              onChange={(v) =>
                void saveFields({ removal_dates_start: v.start, removal_dates_end: v.end })
              }
              placeholder="Not set"
            />
          </div>
        </div>
        <div style={{ borderTop: "1px solid hsl(var(--border))" }} />
        <div className="field-chips">
          <DField label="Tags">
            <RecordCombobox
              multi
              source={{ kind: "lookup", table: "project_tags" }}
              multiValue={project.tags}
              onMultiChange={(next) => void saveField("tags", next)}
              entityLabel="Tag"
              placeholder="Add tag..."
            />
          </DField>
        </div>
      </div>
    </section>
  );
}
