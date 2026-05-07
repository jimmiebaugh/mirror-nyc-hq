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

const navItems: NavItem[] = [
  { to: "/", label: "Dashboard", end: true },
  { to: "/projects", label: "Projects" },
  { to: "/venues", label: "Venues" },
  { to: "/clients", label: "Clients" },
  { to: "/tasks", label: "Tasks" },
  { to: "/talent-scout", label: "Talent Scout", adminOnly: true },
];

// Brand caption next to the M wordmark — reflects which app surface
// the user is currently inside. Defaults to HQ for the core dashboard
// surfaces (/, /projects, /venues, /clients, /tasks).
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
              <span className="hidden sm:inline font-mono text-[20px] font-bold uppercase leading-none tracking-[0.12em] text-primary translate-y-[3px]">
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

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="h-10 gap-2.5 px-2">
                <Avatar className="h-8 w-8">
                  <AvatarFallback className="text-[13px] bg-secondary">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <span className="hidden sm:inline text-[13px] text-muted-foreground">
                  {email}
                </span>
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
      </header>

      <main className="mx-auto max-w-7xl px-6 py-10">
        <Outlet />
      </main>
    </div>
  );
}
