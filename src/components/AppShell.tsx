import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useUserRole } from "@/hooks/useUserRole";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { MirrorMark } from "@/components/MirrorMark";
import { LogOut } from "lucide-react";

type NavItem = { to: string; label: string; end?: boolean; adminOnly?: boolean };

// Phase 3.7.8: Projects / Venues / Clients dropped from the top nav.
// Those surfaces are reachable by drilling in from the Dashboard tile
// grid, so they don't need their own nav slot.
// Phase 3.7.8.12: Tasks also dropped from the top nav. Tasks live
// inside the Dashboard surface alongside Projects / Venues / Clients.
// Talent Scout stays as the cross-cutting admin destination.
// 2026-05-08 update: Dashboard nav slot hidden until that surface is
// built out properly. Talent Scout is the only top-nav destination
// for now. The Dashboard route still exists; the M-wordmark in the
// header links back to / for users who land there.
// Phase 4.2-port: Venue Scout joins the nav, open to all authenticated
// users per port plan § 8.6 (no role gating).
const navItems: NavItem[] = [
  { to: "/talent-scout", label: "Talent Scout", adminOnly: true },
  { to: "/venue-scout", label: "Venue Scout" },
];

// Brand caption next to the M wordmark — reflects which app surface
// the user is currently inside. Defaults to HQ for the core dashboard
// surfaces (/, /projects, /venues, /clients, /tasks). The latter three
// no longer have top-nav slots but the routes still exist (drilled into
// from the Dashboard).
function brandCaptionFor(pathname: string) {
  if (pathname.startsWith("/talent-scout")) return "TALENT";
  if (pathname.startsWith("/venue-scout")) return "VENUES";
  return "HQ";
}

export default function AppShell() {
  const { user, signOut } = useAuth();
  const { isAdmin } = useUserRole();
  const location = useLocation();
  const email = user?.email ?? "";
  const initials = email.slice(0, 2).toUpperCase();
  const visibleNav = navItems.filter((item) => !item.adminOnly || isAdmin);
  const brandCaption = brandCaptionFor(location.pathname);

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur">
        {/* Header bumped from h-14 (56px) to h-16 (64px) to give the larger
             logo + nav typography room to breathe. Still compact for a
             dashboard but no longer cramped. */}
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-6 px-6">
          <div className="flex items-center gap-8">
            <NavLink to="/" className="flex items-end gap-3 text-foreground">
              {/* Mirror M wordmark + HQ caption. The mark IS the brand, so
                  no "Mirror NYC" text — that'd be redundant. "HQ" sits to
                  the right in mono coral as the app identifier, mirroring
                  the deck's "M | TALENT SCOUT" header pattern. */}
              <MirrorMark className="h-[42px] w-auto" />
              {/* leading-none removes Roboto Mono's natural line-box
                   descent space; translate-y nudges the caps down so the
                   visible glyph bottom sits flush with the underbar of the
                   M wordmark instead of floating ~3px above it. */}
              {/* HQ rides slightly larger than the sub-app captions because
                  it's two letters and reads small at 16px next to the
                  42px wordmark. TALENT / VENUES are longer so 16px keeps
                  them from crowding the nav. */}
              <span
                className={`hidden sm:inline font-mono font-bold uppercase leading-none tracking-[0.12em] text-primary ${
                  brandCaption === "HQ"
                    ? "text-[20px] translate-y-[3px]"
                    : "text-[16px] translate-y-[2px]"
                }`}
              >
                {brandCaption}
              </span>
            </NavLink>
            <nav className="hidden md:flex items-center gap-1">
              {visibleNav.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    `rounded-sm px-3 py-2 font-mono text-[13px] font-bold uppercase tracking-[0.08em] transition-colors ${
                      isActive
                        ? "text-foreground bg-secondary"
                        : "text-muted-foreground hover:text-foreground"
                    }`
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>
          </div>

          <div className="flex items-center gap-2">
            {/* Phase 3.7.5.1: Settings link moved over here, next to the
                 user avatar. Still only renders inside Talent Scout for
                 admins. */}
            {location.pathname.startsWith("/talent-scout") && isAdmin && (
              <NavLink
                to="/talent-scout/settings"
                className={({ isActive }) =>
                  `hidden md:inline-flex rounded-sm px-3 py-2 font-mono text-[13px] font-bold uppercase tracking-[0.08em] transition-colors ${
                    isActive
                      ? "text-foreground bg-secondary"
                      : "text-muted-foreground hover:text-foreground"
                  }`
                }
              >
                Settings
              </NavLink>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="h-10 px-2">
                  <Avatar className="h-8 w-8">
                    <AvatarFallback className="text-[13px] bg-secondary">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="font-normal">
                  <div className="text-xs text-muted-foreground">Signed in as</div>
                  <div className="truncate text-sm">{email}</div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={signOut}>
                  <LogOut className="mr-2 h-4 w-4" />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-10">
        <Outlet />
      </main>
    </div>
  );
}
