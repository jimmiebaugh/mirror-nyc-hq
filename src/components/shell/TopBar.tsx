import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/hooks/useAuth";
import { IconSearch } from "@/components/icons/HQIcons";
import { MentionBellPanel } from "./MentionBellPanel";
import { NotificationBellPanel } from "./NotificationBellPanel";

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
  const { signOut, user } = useAuth();
  const userId = user?.id ?? null;
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  // cmd-k focus shortcut.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
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
      <div className="hq-topbar-spacer flex-1" />
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
