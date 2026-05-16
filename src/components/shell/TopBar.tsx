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
}: {
  fullName?: string | null;
  email: string;
}) {
  const navigate = useNavigate();
  const { signOut } = useAuth();
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
      <form className="hq-searchbar" onSubmit={onSubmit}>
        <IconSearch className="h-[14px] w-[14px]" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search projects, venues, people, wiki..."
          aria-label="Global search"
        />
      </form>
      <div className="flex-1" />
      <NotificationBellPanel />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className="hq-avatar">
            {initials}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem disabled>Profile (5.4)</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={signOut}>Sign out</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}