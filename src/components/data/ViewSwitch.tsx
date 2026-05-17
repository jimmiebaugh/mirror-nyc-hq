import { useNavigate } from "react-router-dom";
import {
  IconList,
  IconBoard,
  IconTimeline,
  IconCalendar,
} from "@/components/icons/HQIcons";

/**
 * Tabbed view switcher for HQ Core database list pages. Wireframe-fidelity
 * rebuild (Phase 5.2.1 Revision); renders the icon-segmented inline-flex
 * pattern from lines 985-991 / 1095-1100 / 1249-1254 / 2218-2219 of
 * OUTPUTS/phase-5-hq-wireframe-v1-LOCKED.html, NOT shadcn Tabs / pills.
 *
 * The component used to take a `surface` enum + route the user via
 * navigate(). The revision keeps that behavior available (pass `surface`
 * and omit `onChange`) but also lets the parent override via `onChange`
 * (so SavedViewsDropdown can drive view-kind navigation through the same
 * route map).
 */

export type ViewKind = "list" | "board" | "timeline" | "calendar";

export type Surface =
  | "projects"
  | "tasks"
  | "deliverables"
  | "venues"
  | "clients"
  | "vendors"
  | "people";

const ITEMS: Array<{ kind: ViewKind; label: string; Icon: typeof IconList }> = [
  { kind: "list", label: "List", Icon: IconList },
  { kind: "board", label: "Board", Icon: IconBoard },
  { kind: "timeline", label: "Timeline", Icon: IconTimeline },
  { kind: "calendar", label: "Calendar", Icon: IconCalendar },
];

const SURFACE_ROUTES: Record<Surface, Partial<Record<ViewKind, string>>> = {
  projects: {
    list: "/projects",
    board: "/projects/board",
    timeline: "/projects/timeline",
    calendar: "/calendar?source=projects",
  },
  tasks: {
    list: "/tasks",
    board: "/tasks/board",
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
  clients: {
    list: "/clients",
  },
  vendors: {
    list: "/vendors",
  },
  people: {
    list: "/people",
  },
};

export function viewSwitchRoute(surface: Surface, kind: ViewKind): string | undefined {
  return SURFACE_ROUTES[surface][kind];
}

export function ViewSwitch({
  active,
  available,
  surface,
  onChange,
}: {
  active: ViewKind;
  available: ViewKind[];
  /** Optional: enables the default navigate-on-click handler. */
  surface?: Surface;
  /** Caller overrides default navigation. Receives the picked view kind. */
  onChange?: (kind: ViewKind) => void;
}) {
  const navigate = useNavigate();

  const handle = (kind: ViewKind) => {
    if (onChange) {
      onChange(kind);
      return;
    }
    if (surface) {
      const target = SURFACE_ROUTES[surface][kind];
      if (target) navigate(target);
    }
  };

  return (
    <div className="viewswitch" role="tablist">
      {ITEMS.filter((i) => available.includes(i.kind)).map((i) => {
        const isActive = i.kind === active;
        return (
          <button
            key={i.kind}
            type="button"
            role="tab"
            aria-selected={isActive}
            className={isActive ? "on" : undefined}
            onClick={() => handle(i.kind)}
          >
            <i.Icon className="ic" />
            {i.label}
          </button>
        );
      })}
    </div>
  );
}
