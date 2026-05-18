import { useNavigate } from "react-router-dom";
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
  avatarUrl,
}: {
  fullName?: string | null;
  email: string;
  tier: Tier;
  avatarUrl?: string | null;
}) {
  const { signOut, user } = useAuth();
  const navigate = useNavigate();
  const initials = initialsFor(fullName, email);
  const display = (fullName || email).trim();
  const userId = user?.id ?? null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="hq-rail-foot w-full text-left">
          <span className="hq-rail-av" aria-label={initials}>
            {avatarUrl ? (
              <img src={avatarUrl} alt={initials} referrerPolicy="no-referrer" />
            ) : (
              initials
            )}
          </span>
          <span className="hq-rail-who">
            <b>{display}</b>
            <span>{tier}</span>
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-56">
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
  );
}