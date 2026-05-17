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
  canPublishGlobal,
  canResetToGlobal,
  onPublishGlobal,
  onResetToGlobal,
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
  /**
   * Phase 5.6.5. Renders the owner-only "Save as global calendar
   * default" button below the master-toggle divider.
   */
  canPublishGlobal?: boolean;
  /**
   * Phase 5.6.5. Renders the "Reset to global default" button (visible
   * to every user with a per-user row when a global default exists).
   */
  canResetToGlobal?: boolean;
  onPublishGlobal?: () => void;
  onResetToGlobal?: () => void;
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
            label="Tentative"
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
        {canPublishGlobal || canResetToGlobal ? (
          <div className="stack-2">
            {canPublishGlobal ? (
              <button
                type="button"
                className="tlink"
                style={{
                  padding: "6px 8px",
                  fontSize: 11,
                  color: "hsl(var(--primary))",
                  justifyContent: "flex-start",
                }}
                onClick={onPublishGlobal}
              >
                Save as global calendar default
              </button>
            ) : null}
            {canResetToGlobal ? (
              <button
                type="button"
                className="tlink"
                style={{
                  padding: "6px 8px",
                  fontSize: 11,
                  justifyContent: "flex-start",
                }}
                onClick={onResetToGlobal}
              >
                Reset to global default
              </button>
            ) : null}
          </div>
        ) : null}
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
              return (
                <ToggleRow
                  key={p.id}
                  clientName={p.clientName}
                  label={p.name}
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
  clientName,
  pressed,
  dim,
  onChange,
}: {
  label: string;
  clientName?: string | null;
  pressed: boolean;
  dim?: boolean;
  onChange: (v: boolean) => void;
}) {
  const titleAttr = clientName ? `${clientName} · ${label}` : label;
  return (
    <div
      className="row between"
      style={{ alignItems: "center", gap: 8, minHeight: 28 }}
    >
      <div style={{ minWidth: 0, flex: 1 }} title={titleAttr}>
        {clientName ? (
          <div
            style={{
              fontSize: 11,
              color: dim
                ? "hsl(var(--subtle-foreground))"
                : "hsl(var(--primary))",
              lineHeight: 1.25,
              wordBreak: "break-word",
            }}
          >
            {clientName}
          </div>
        ) : null}
        <div
          style={{
            fontSize: 12.5,
            color: dim
              ? "hsl(var(--subtle-foreground))"
              : "hsl(var(--foreground))",
            lineHeight: 1.3,
            wordBreak: "break-word",
          }}
        >
          {label}
        </div>
      </div>
      <Switch checked={pressed} onCheckedChange={onChange} />
    </div>
  );
}
