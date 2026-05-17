import type { ComponentType } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { MirrorMark } from "@/components/MirrorMark";
import {
  IconHome,
  IconProjects,
  IconTasks,
  IconDeliverables,
  IconCalendar,
  IconVenues,
  IconOrgs,
  IconClients,
  IconPeople,
  IconActivity,
  IconSearch,
  IconScout,
  IconWiki,
  IconTeam,
  IconOutlook,
  IconSettings,
} from "@/components/icons/HQIcons";
import { RailFooter } from "@/components/shell/RailFooter";

// Phase 5.2.1 rail amendment (OUTPUTS/phase-5-2-rail-amendment.md):
// - Single ordered Tools group with per-item adminOnly flag (no second
//   sub-heading for admin-only items).
// - Tool-app rail variant: when the route is under /talent-scout or
//   /venue-scout, the Primary group collapses to HQ Home + Activity Feed.

type RailItem = {
  to: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  /** Render the in-row count badge with this number. Renders nothing when 0. */
  count?: number;
  /** Hide for non-admin users when true. */
  adminOnly?: boolean;
};

// Phase 5.2.3 rail order (locked Q2 of phase-5-2-3-spec.md § 0c): high-
// frequency lookups first (Venues / Vendors near top); Clients fall to
// the bottom of the entity group since rare use. Organizations row from
// the 5.2.2 ship is replaced with Vendors + Clients per the table split.
const PRIMARY_ITEMS: RailItem[] = [
  { to: "/home", label: "Home", icon: IconHome },
  { to: "/projects", label: "Projects", icon: IconProjects },
  { to: "/tasks", label: "Tasks", icon: IconTasks },
  { to: "/deliverables", label: "Deliverables", icon: IconDeliverables },
  { to: "/calendar", label: "Calendar", icon: IconCalendar },
  { to: "/venues", label: "Venues", icon: IconVenues },
  { to: "/vendors", label: "Vendors", icon: IconOrgs },
  { to: "/people", label: "People", icon: IconPeople },
  { to: "/clients", label: "Clients", icon: IconClients },
  { to: "/activity", label: "Activity Feed", icon: IconActivity },
  { to: "/search", label: "Search", icon: IconSearch },
];

// Locked ordering per rail amendment § 1.
const TOOLS_ITEMS: RailItem[] = [
  { to: "/wiki", label: "Wiki", icon: IconWiki },
  { to: "/talent-scout", label: "Talent Scout", icon: IconScout, adminOnly: true },
  { to: "/venue-scout", label: "Venue Scout", icon: IconScout },
  { to: "/users", label: "Users", icon: IconTeam, adminOnly: true },
  { to: "/outlook", label: "Outlook", icon: IconOutlook, adminOnly: true },
  { to: "/settings", label: "Settings", icon: IconSettings, adminOnly: true },
];

const TOOL_APP_PRIMARY: RailItem[] = [
  { to: "/home", label: "HQ Home", icon: IconHome },
  { to: "/activity", label: "Activity Feed", icon: IconActivity },
];

function RailLink({ item }: { item: RailItem }) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      className={({ isActive }) =>
        `hq-ri ${isActive ? "hq-ri--active" : ""}`
      }
    >
      <Icon className="h-4 w-4" />
      <span>{item.label}</span>
      {item.count && item.count > 0 ? (
        <span className="hq-ri-count">{item.count}</span>
      ) : null}
    </NavLink>
  );
}

type Tier = "Admin" | "Standard" | "Freelance";

export function LeftRail({
  isAdmin,
  tasksOpenCount,
  fullName,
  email,
  tier,
}: {
  isAdmin: boolean;
  tasksOpenCount: number;
  fullName?: string | null;
  email: string;
  tier: Tier;
}) {
  const { pathname } = useLocation();
  const isToolApp =
    pathname.startsWith("/talent-scout") || pathname.startsWith("/venue-scout");

  const primary = isToolApp
    ? TOOL_APP_PRIMARY
    : PRIMARY_ITEMS.map((item) =>
        item.to === "/tasks" ? { ...item, count: tasksOpenCount } : item,
      );

  const tools = TOOLS_ITEMS.filter((item) => !item.adminOnly || isAdmin);

  return (
    <aside className="hq-rail">
      <div className="hq-brand">
        <MirrorMark className="h-[33px] w-[23px] flex-none" />
        <span className="hq-brand-txt">
          Mirror <span className="hq-brand-hq">HQ</span>
        </span>
      </div>
      <nav className="hq-rail-nav">
        {primary.map((item) => (
          <RailLink key={item.to} item={item} />
        ))}
        <div className="hq-rail-grp">Tools</div>
        {tools.map((item) => (
          <RailLink key={item.to} item={item} />
        ))}
      </nav>
      <RailFooter fullName={fullName} email={email} tier={tier} />
    </aside>
  );
}
