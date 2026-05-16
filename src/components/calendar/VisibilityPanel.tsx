import { Switch } from "@/components/ui/switch";

/**
 * Calendar visibility right rail (Phase 5.3 spec § 4a, Surface 15
 * wireframe). 232px card with a master Deliverables toggle, Mirror
 * Holidays toggle, shared Outlook toggle, divider, then per-project
 * toggle rows. Off-state projects render in subtle-foreground color.
 */

export type VisibilityProject = {
  id: string;
  clientName: string | null;
  name: string;
};

export function CalendarVisibilityPanel({
  showDeliverables,
  showHolidays,
  showSharedOutlook,
  hiddenProjectIds,
  projects,
  onSetShowDeliverables,
  onSetShowHolidays,
  onSetShowSharedOutlook,
  onToggleProject,
}: {
  showDeliverables: boolean;
  showHolidays: boolean;
  showSharedOutlook: boolean;
  hiddenProjectIds: string[];
  projects: VisibilityProject[];
  onSetShowDeliverables: (v: boolean) => void;
  onSetShowHolidays: (v: boolean) => void;
  onSetShowSharedOutlook: (v: boolean) => void;
  onToggleProject: (id: string, visible: boolean) => void;
}) {
  const hiddenSet = new Set(hiddenProjectIds);
  return (
    <aside className="card">
      <div className="card-pad stack-3">
        <div className="block-lbl">
          <span className="label-section">Show on calendar</span>
        </div>
        <div className="stack-2">
          <ToggleRow
            label="Deliverables"
            pressed={showDeliverables}
            onChange={onSetShowDeliverables}
          />
          <ToggleRow
            label="Mirror Holidays"
            pressed={showHolidays}
            onChange={onSetShowHolidays}
          />
          <ToggleRow
            label="Shared Outlook"
            pressed={showSharedOutlook}
            onChange={onSetShowSharedOutlook}
          />
        </div>
        <div
          style={{
            height: 1,
            background: "hsl(var(--border))",
            margin: "4px 0",
          }}
        />
        <div className="block-lbl">
          <span className="label-section">Projects</span>
        </div>
        <div className="stack-2">
          {projects.length === 0 ? (
            <span className="subtle" style={{ fontSize: 12 }}>
              No projects loaded.
            </span>
          ) : (
            projects.map((p) => {
              const visible = !hiddenSet.has(p.id);
              const label = p.clientName ? `${p.clientName} · ${p.name}` : p.name;
              return (
                <ToggleRow
                  key={p.id}
                  label={label}
                  pressed={visible}
                  dim={!visible}
                  onChange={(v) => onToggleProject(p.id, v)}
                />
              );
            })
          )}
        </div>
      </div>
    </aside>
  );
}

function ToggleRow({
  label,
  pressed,
  dim,
  onChange,
}: {
  label: string;
  pressed: boolean;
  dim?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div
      className="row between"
      style={{ alignItems: "center", gap: 8, minHeight: 28 }}
    >
      <span
        style={{
          fontSize: 12.5,
          color: dim
            ? "hsl(var(--subtle-foreground))"
            : "hsl(var(--foreground))",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
        title={label}
      >
        {label}
      </span>
      <Switch checked={pressed} onCheckedChange={onChange} />
    </div>
  );
}
