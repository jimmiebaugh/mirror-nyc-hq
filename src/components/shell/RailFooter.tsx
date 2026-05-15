import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/hooks/useAuth";

type Tier = "Admin" | "Standard" | "Freelance";

function initialsFor(name?: string | null, email?: string | null) {
  const base = (name || email || "??").trim();
  const parts = base.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return base.slice(0, 2).toUpperCase();
}

export function RailFooter({
  fullName,
  email,
  tier,
}: {
  fullName?: string | null;
  email: string;
  tier: Tier;
}) {
  const { signOut } = useAuth();
  const initials = initialsFor(fullName, email);
  const display = (fullName || email).trim();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="hq-rail-foot w-full text-left">
          <span className="hq-rail-av">{initials}</span>
          <span className="hq-rail-who">
            <b>{display}</b>
            <span>{tier}</span>
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-56">
        <DropdownMenuItem disabled>Profile (5.4)</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={signOut}>Sign out</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}