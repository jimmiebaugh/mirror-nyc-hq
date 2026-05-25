import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useLocation, useMatch, useNavigate } from "react-router-dom";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/hooks/useAuth";
import { IconArrowLeft, IconSearch } from "@/components/icons/HQIcons";
import { useReferrerCrumb } from "@/hooks/useReferrerCrumb";
import { MentionBellPanel } from "./MentionBellPanel";
import { NotificationBellPanel } from "./NotificationBellPanel";
import { supabase } from "@/integrations/supabase/client";

function initialsFor(name?: string | null, email?: string | null) {
  const base = (name || email || "??").trim();
  const parts = base.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return base.slice(0, 2).toUpperCase();
}

export function TopBar({
  fullName,
  email,
  avatarUrl,
  onMenuClick,
}: {
  fullName?: string | null;
  email: string;
  avatarUrl?: string | null;
  /** Opens the mobile nav drawer. Button is hidden at >=1024px via CSS. */
  onMenuClick?: () => void;
}) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { signOut, user } = useAuth();
  const userId = user?.id ?? null;
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  // Phase 5.12.12: hide the global search bar inside /venue-scout/*.
  // Global search indexes HQ Core entities (Projects / Venues / Vendors /
  // People / Clients / Outlook); it is not VS-scoped, so surfacing it on
  // VS pages misleads producers expecting scout / candidate-venue search.
  const hideSearch = pathname.startsWith("/venue-scout");

  // R7 § E: detect active VS scout route and surface the client + event
  // name in the TopBar's center zone. `useMatch` works outside the routed
  // component (AppShell wraps Outlet; TopBar is a shell sibling) since it
  // matches the current pathname. Trailing `/*` so any nested scout route
  // (brief, sourcing, shortlist, review, settings) carries the center
  // label through.
  const scoutMatch = useMatch("/venue-scout/scouts/:id/*");
  const scoutId = scoutMatch?.params.id ?? null;
  const [scoutLabel, setScoutLabel] = useState<{
    client_name: string | null;
    event_name: string | null;
  } | null>(null);

  useEffect(() => {
    if (!scoutId) {
      setScoutLabel(null);
      return;
    }
    let active = true;
    supabase
      .from("vs_scouts")
      .select("client_name, event_name")
      .eq("id", scoutId)
      .maybeSingle()
      .then(({ data }) => {
        if (!active) return;
        setScoutLabel(
          data
            ? {
                client_name: (data.client_name as string | null) ?? null,
                event_name: (data.event_name as string | null) ?? null,
              }
            : null,
        );
      });
    return () => {
      active = false;
    };
  }, [scoutId]);

  // cmd-k focus shortcut. Phase 5.12.12: pass through to the browser
  // (do NOT preventDefault) when there's no search input mounted, so the
  // shortcut doesn't get swallowed inside /venue-scout/* where the search
  // bar is hidden.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        if (!inputRef.current) return;
        e.preventDefault();
        inputRef.current.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const term = query.trim();
    if (!term) return;
    navigate(`/search?q=${encodeURIComponent(term)}`);
  };

  const initials = initialsFor(fullName, email);

  // R7 amendment v3 § 3: back-crumb relocated from per-page chrome into
  // TopBar's left zone. `useReferrerCrumb` resolves the destination via
  // its existing 3-tier priority (state.from → sessionStorage referrer →
  // canonical-parent route table); on root-tier surfaces it resolves to
  // `/` which we hide so the TopBar doesn't surface a useless "Back to
  // HQ" affordance on every list page. Hidden below `md` (768px) so
  // mobile TopBar stays clean alongside the search bar + bells + avatar.
  const referrerCrumb = useReferrerCrumb();
  const showCrumb = referrerCrumb.href !== "/";

  return (
    <div className="hq-topbar">
      <button
        type="button"
        className="hq-iconbtn hq-menu-btn"
        onClick={onMenuClick}
        aria-label="Open navigation"
      >
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <line x1="3" y1="6" x2="21" y2="6" />
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="3" y1="18" x2="21" y2="18" />
        </svg>
      </button>
      {showCrumb ? (
        // R7 amendment v4 § 1 → R7 amendment v5 § 1: inline divider
        // reverted (LeftRail's right border is the intended visual
        // divider; the inline element was added in error).
        <Link to={referrerCrumb.href} className="crumb hidden md:inline-flex">
          <IconArrowLeft className="ic ic-sm" />
          {referrerCrumb.label}
        </Link>
      ) : null}
      {!hideSearch ? (
        <form className="hq-searchbar" onSubmit={onSubmit}>
          <IconSearch className="h-[14px] w-[14px]" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search"
            aria-label="Global search"
          />
        </form>
      ) : null}
      {/* R7 § E: center zone renders Client + Event name when the user is
          inside an active VS scout route. Otherwise the spacer holds the
          flex layout. Hidden on narrow widths (md breakpoint, ~768px) so
          the user menu + bells don't squeeze. */}
      {scoutLabel && (scoutLabel.client_name || scoutLabel.event_name) ? (
        <div className="hidden md:flex flex-1 items-center justify-center min-w-0 px-4">
          <span className="hq-scout-label truncate">
            {scoutLabel.client_name && (
              <span>{scoutLabel.client_name}</span>
            )}
            {scoutLabel.client_name && scoutLabel.event_name ? (
              <span className="mx-2 opacity-50">·</span>
            ) : null}
            {scoutLabel.event_name && (
              <span>{scoutLabel.event_name}</span>
            )}
          </span>
        </div>
      ) : (
        <div className="hq-topbar-spacer flex-1" />
      )}
      <MentionBellPanel />
      <NotificationBellPanel />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className="hq-avatar" aria-label={initials}>
            {avatarUrl ? (
              <img src={avatarUrl} alt={initials} referrerPolicy="no-referrer" />
            ) : (
              initials
            )}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {userId ? (
            <DropdownMenuItem onClick={() => navigate(`/users/${userId}`)}>
              Your profile
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onClick={() => navigate("/settings/profile")}>
            Profile settings
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={signOut}>Sign out</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
