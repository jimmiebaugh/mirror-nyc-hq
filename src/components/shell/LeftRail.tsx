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
  IconTalentScout,
  IconVenueScout,
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
  { to: "/talent-scout", label: "Talent Scout", icon: IconTalentScout, adminOnly: true },
  { to: "/venue-scout", label: "Venue Scout", icon: IconVenueScout },
  { to: "/users", label: "Users", icon: IconTeam, adminOnly: true },
  { to: "/outlook", label: "Outlook", icon: IconOutlook, adminOnly: true },
  { to: "/settings", label: "Settings", icon: IconSettings, adminOnly: true },
];

const TOOL_APP_PRIMARY: RailItem[] = [
  { to: "/home", label: "HQ Home", icon: IconHome },
  { to: "/activity", label: "Activity Feed", icon: IconActivity },
  { to: "/settings", label: "Settings", icon: IconSettings, adminOnly: true },
];

// Phase 5.12.12: VS-specific tool-items group rendered when on
// /venue-scout/*. Replaces the standard Tools group in that context.
// R7 amendment v1 § 4 → R7 amendment v2 § 4: sidebar label drops the
// literal `+` prefix (the IconPlus already conveys the affordance);
// ScoutIndex's page header CTA keeps the `+` text for primary-CTA
// emphasis.
const VS_TOOL_ITEMS: RailItem[] = [
  { to: "/venue-scout", label: "Venue Scout", icon: IconVenueScout },
  { to: "/venue-scout/overview", label: "New Scout", icon: IconPlus, indent: true },
  { to: "/venue-scout/settings", label: "Settings", icon: IconSettings, indent: true, adminOnly: true },
];

// Phase 5.13.1: TS-specific tool-items group, parallel to VS_TOOL_ITEMS.
const TS_TOOL_ITEMS: RailItem[] = [
  { to: "/talent-scout", label: "Talent Scout", icon: IconTalentScout },
  { to: "/talent-scout/new/details", label: "New Role", icon: IconPlus, indent: true },
  { to: "/talent-scout/settings", label: "Settings", icon: IconSettings, indent: true, adminOnly: true },
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

function BrandTS({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <Link to="/talent-scout" className="hq-brand" aria-label="Mirror Talent Scout home" onClick={onNavigate}>
      <MirrorMark className="h-[33px] w-[23px] flex-none" />
      {/* Phase 5.13.2c: whitespace-nowrap keeps "Talent Scout" on one line.
          Without it the 21px ExtraBold uppercase wordmark wraps in the
          232px rail (12-char "Talent Scout" is just over the available
          inline space); the 11-char "Venue Scout" stays on one line
          naturally. */}
      <span className="hq-brand-txt whitespace-nowrap">
        Talent <span className="hq-brand-ts">Scout</span>
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
  const isTS = pathname.startsWith("/talent-scout");

  const primary = isToolApp
    ? TOOL_APP_PRIMARY.filter((item) => !item.adminOnly || isAdmin)
    : PRIMARY_ITEMS.map((item) =>
        item.to === "/tasks" ? { ...item, count: tasksOpenCount } : item,
      );

  // VS + TS: hide the Tools group, render tool-specific rows with no group
  // heading, force coral active styling throughout their route prefix.
  // HQ: keep the Tools group with resolveSettingsHref on the Settings entry.
  const groupItems: RailItem[] = isVS
    ? VS_TOOL_ITEMS.filter((item) => !item.adminOnly || isAdmin).map((item) => ({
        ...item,
        forceActive: true,
      }))
    : isTS
    ? TS_TOOL_ITEMS.filter((item) => !item.adminOnly || isAdmin).map((item) => ({
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
      {isVS ? <BrandVS onNavigate={onNavigate} /> : isTS ? <BrandTS onNavigate={onNavigate} /> : <BrandHQ onNavigate={onNavigate} />}
      <nav className="hq-rail-nav">
        {primary.map((item) => (
          <RailLink key={item.to} item={item} onNavigate={onNavigate} />
        ))}
        {!isVS && !isTS && <div className="hq-rail-grp">Tools</div>}
        {groupItems.map((item) => (
          <RailLink key={item.to} item={item} onNavigate={onNavigate} />
        ))}
        {isTS && (
          <RailLink
            item={{ to: "/venue-scout", label: "Venue Scout", icon: IconVenueScout }}
            onNavigate={onNavigate}
          />
        )}
        {isVS && isAdmin && (
          <RailLink
            item={{ to: "/talent-scout", label: "Talent Scout", icon: IconTalentScout }}
            onNavigate={onNavigate}
          />
        )}
      </nav>
      <RailFooter fullName={fullName} email={email} tier={tier} avatarUrl={avatarUrl} />
    </aside>
  );
}
