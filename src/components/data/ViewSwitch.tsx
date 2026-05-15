import { useNavigate } from "react-router-dom";

/**
 * Tabbed view switcher for HQ Core database list pages. Each surface owns
 * its own subset of view kinds (Projects has all four; Tasks drops
 * Timeline; Deliverables drops Timeline; Organizations / People drop
 * Timeline + Calendar). The mapping from view kind to route is per-surface
 * because some calendar tabs route into the unified /calendar surface
 * pre-filtered.
 *
 * Spec: OUTPUTS/phase-5-2-spec.md § 5.A.1 (component contract).
 */

export type ViewKind = "list" | "board" | "timeline" | "calendar";

export type Surface =
  | "projects"
  | "tasks"
  | "deliverables"
  | "venues"
  | "organizations"
  | "people";

const LABEL: Record<ViewKind, string> = {
  list: "List",
  board: "Board",
  timeline: "Timeline",
  calendar: "Calendar",
};

const ROUTES: Record<Surface, Partial<Record<ViewKind, string>>> = {
  projects: {
    list: "/projects",
    board: "/projects/board",
    timeline: "/projects/timeline",
    calendar: "/calendar?source=projects",
  },
  tasks: {
    list: "/tasks",
    board: "/tasks/board",
    calendar: "/calendar?source=tasks",
  },
  deliverables: {
    list: "/deliverables/list",
    board: "/deliverables/board",
    calendar: "/deliverables",
  },
  venues: {
    list: "/venues",
    board: "/venues/board",
  },
  organizations: {
    list: "/organizations",
    board: "/organizations/board",
  },
  people: {
    list: "/people",
  },
};

export function ViewSwitch({
  active,
  surface,
  available,
}: {
  active: ViewKind;
  surface: Surface;
  available?: ViewKind[];
}) {
  const navigate = useNavigate();
  const tabs: ViewKind[] = available ?? (["list", "board", "timeline", "calendar"] as ViewKind[])
    .filter((k) => Boolean(ROUTES[surface][k]));

  return (
    <div className="hq-viewswitch" role="tablist">
      {tabs.map((kind) => {
        const isActive = kind === active;
        const target = ROUTES[surface][kind];
        return (
          <button
            key={kind}
            type="button"
            role="tab"
            aria-selected={isActive}
            className={`hq-viewswitch-tab ${isActive ? "hq-viewswitch-tab--active" : ""}`}
            onClick={() => target && navigate(target)}
            disabled={!target}
          >
            {LABEL[kind]}
          </button>
        );
      })}
    </div>
  );
}
