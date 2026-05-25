import type { ComponentType } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
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
  IconPlus,
  IconWiki,
  IconTeam,
  IconOutlook,
  IconSettings,
} from "@/components/icons/HQIcons";
import { RailFooter } from "@/components/shell/RailFooter";
import { resolveSettingsHref } from "@/lib/shell/resolveSettingsHref";

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
  /** Phase 5.12.12: indent the item one level (for grouped sub-items). */
  indent?: boolean;
  /** Phase 5.12.12: force active styling regardless of NavLink's isActive match
   * (used for VS group rows so all three stay coral throughout /venue-scout/*). */
  forceActive?: boolean;
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

// Phase 5.12.12: VS-specific tool-items group rendered when on
// /venue-scout/*. Replaces the standard Tools group in that context.
// R7 amendment v1 § 4 → R7 amendment v2 § 4: sidebar label drops the
// literal `+` prefix (the IconPlus already conveys the affordance);
// ScoutIndex's page header CTA keeps the `+` text for primary-CTA
// emphasis.
const VS_TOOL_ITEMS: RailItem[] = [
  { to: "/venue-scout", label: "Venue Scout", icon: IconScout },
  { to: "/venue-scout/overview", label: "New Scout", icon: IconPlus, indent: true },
  { to: "/venue-scout/settings", label: "Settings", icon: IconSettings, indent: true, adminOnly: true },
];

function RailLink({ item, onNavigate }: { item: RailItem; onNavigate?: () => void }) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      onClick={onNavigate}
      className={({ isActive }) =>
        `hq-ri ${isActive || item.forceActive ? "hq-ri--active" : ""} ${item.indent ? "hq-ri--indent" : ""}`
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

function BrandHQ({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <Link to="/home" className="hq-brand" aria-label="Mirror HQ home" onClick={onNavigate}>
      <MirrorMark className="h-[33px] w-[23px] flex-none" />
      <span className="hq-brand-txt">
        Mirror <span className="hq-brand-hq">HQ</span>
      </span>
    </Link>
  );
}

function BrandVS({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <Link to="/venue-scout" className="hq-brand" aria-label="Mirror Venue Scout home" onClick={onNavigate}>
      <MirrorMark className="h-[33px] w-[23px] flex-none" />
      <span className="hq-brand-txt">
        Venue <span className="hq-brand-vs">Scout</span>
      </span>
    </Link>
  );
}

type Tier = "Admin" | "Standard" | "Freelance";

export function LeftRail({
  isAdmin,
  tasksOpenCount,
  fullName,
  email,
  tier,
  avatarUrl,
  open = false,
  onNavigate,
}: {
  isAdmin: boolean;
  tasksOpenCount: number;
  fullName?: string | null;
  email: string;
  tier: Tier;
  avatarUrl?: string | null;
  /** Mobile drawer open state (ignored at >=1024px where the rail is static). */
  open?: boolean;
  /** Called when a nav link is tapped, so the parent can close the drawer. */
  onNavigate?: () => void;
}) {
  const { pathname } = useLocation();
  const isToolApp =
    pathname.startsWith("/talent-scout") || pathname.startsWith("/venue-scout");
  const isVS = pathname.startsWith("/venue-scout");

  const primary = isToolApp
    ? TOOL_APP_PRIMARY
    : PRIMARY_ITEMS.map((item) =>
        item.to === "/tasks" ? { ...item, count: tasksOpenCount } : item,
      );

  // Phase 5.12.12: pick the second nav group based on context.
  // VS context: hide the Tools group, render the VS_TOOL_ITEMS rows
  // directly under Activity Feed with no group heading; force coral
  // active styling on all three so they stay highlighted throughout
  // /venue-scout/*.
  // HQ / TS context: keep the Tools group (with resolveSettingsHref
  // applied to the Settings entry so TS routes to /talent-scout/settings).
  const groupItems: RailItem[] = isVS
    ? VS_TOOL_ITEMS.filter((item) => !item.adminOnly || isAdmin).map((item) => ({
        ...item,
        forceActive: true,
      }))
    : TOOLS_ITEMS.filter((item) => !item.adminOnly || isAdmin).map((item) =>
        item.label === "Settings"
          ? { ...item, to: resolveSettingsHref(pathname) }
          : item,
      );

  return (
    <aside className={`hq-rail ${open ? "hq-rail--open" : ""}`}>
      {isVS ? <BrandVS onNavigate={onNavigate} /> : <BrandHQ onNavigate={onNavigate} />}
      <nav className="hq-rail-nav">
        {primary.map((item) => (
          <RailLink key={item.to} item={item} onNavigate={onNavigate} />
        ))}
        {!isVS && <div className="hq-rail-grp">Tools</div>}
        {groupItems.map((item) => (
          <RailLink key={item.to} item={item} onNavigate={onNavigate} />
        ))}
      </nav>
      <RailFooter fullName={fullName} email={email} tier={tier} avatarUrl={avatarUrl} />
    </aside>
  );
}
