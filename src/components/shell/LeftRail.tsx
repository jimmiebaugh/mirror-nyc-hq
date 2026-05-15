import type { ComponentType } from "react";
import { NavLink } from "react-router-dom";
import { MirrorMark } from "@/components/MirrorMark";
import {
  IconHome,
  IconProjects,
  IconTasks,
  IconDeliverables,
  IconCalendar,
  IconVenues,
  IconOrgs,
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

type RailItem = {
  to: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  /** Render the in-row count badge with this number. Renders nothing when 0. */
  count?: number;
};

const PRIMARY_ITEMS: RailItem[] = [
  { to: "/home", label: "Home", icon: IconHome },
  { to: "/projects", label: "Projects", icon: IconProjects },
  { to: "/tasks", label: "Tasks", icon: IconTasks },
  { to: "/deliverables", label: "Deliverables", icon: IconDeliverables },
  { to: "/calendar", label: "Calendar", icon: IconCalendar },
  { to: "/venues", label: "Venues", icon: IconVenues },
  { to: "/organizations", label: "Organizations", icon: IconOrgs },
  { to: "/people", label: "People", icon: IconPeople },
  { to: "/activity", label: "Activity Feed", icon: IconActivity },
  { to: "/search", label: "Search", icon: IconSearch },
];

const TOOLS_ITEMS: RailItem[] = [
  { to: "/venue-scout", label: "Venue Scout", icon: IconScout },
  { to: "/wiki", label: "Wiki", icon: IconWiki },
];

const ADMIN_ITEMS: RailItem[] = [
  { to: "/talent-scout", label: "Talent Scout", icon: IconScout },
  { to: "/team", label: "Team", icon: IconTeam },
  { to: "/outlook", label: "Outlook", icon: IconOutlook },
  { to: "/settings", label: "Settings", icon: IconSettings },
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
  const primary = PRIMARY_ITEMS.map((item) =>
    item.to === "/tasks" ? { ...item, count: tasksOpenCount } : item,
  );

  return (
    <aside className="hq-rail">
      <div className="hq-brand">
        <MirrorMark className="h-[22px] w-[15px] flex-none" />
        <span className="hq-brand-txt">
          Mirror <span className="hq-brand-hq">HQ</span>
        </span>
      </div>
      <nav className="hq-rail-nav">
        {primary.map((item) => (
          <RailLink key={item.to} item={item} />
        ))}
        <div className="hq-rail-grp">Tools</div>
        {TOOLS_ITEMS.map((item) => (
          <RailLink key={item.to} item={item} />
        ))}
        {isAdmin
          ? ADMIN_ITEMS.map((item) => <RailLink key={item.to} item={item} />)
          : null}
      </nav>
      <RailFooter fullName={fullName} email={email} tier={tier} />
    </aside>
  );
}