import { useLocation } from "react-router-dom";
import { useUserRole } from "@/hooks/useUserRole";
import { PermissionDenied } from "@/components/ui/PermissionDenied";

/**
 * Gate for admin-only routes. Renders children when the current user is an
 * admin per public.users.permission_role. Phase 5.5 (spec § 7): renders the
 * shared <PermissionDenied> card in-place instead of redirecting to /home so
 * users see a clear "no access" message with a route-aware title.
 *
 * Mounted INSIDE ProtectedRoute, so authentication is already enforced.
 */

type SurfaceLabel = { title: string; surface: string };

const SURFACE_LABELS: { match: RegExp; data: SurfaceLabel }[] = [
  { match: /^\/outlook/, data: { title: "Outlook is admin-only", surface: "The Outlook database" } },
  { match: /^\/settings\/bulk-import/, data: { title: "Bulk import is admin-only", surface: "Bulk import" } },
  { match: /^\/settings/, data: { title: "Settings is admin-only", surface: "Settings" } },
  { match: /^\/users/, data: { title: "Team management is admin-only", surface: "Team management" } },
  { match: /^\/team/, data: { title: "Team management is admin-only", surface: "Team management" } },
  { match: /^\/talent-scout/, data: { title: "Talent Scout is admin-only", surface: "Talent Scout" } },
  { match: /^\/wiki\/(new|.+\/edit)/, data: { title: "Editing the Wiki is admin-only", surface: "Editing Wiki pages" } },
];

function labelForPath(pathname: string): SurfaceLabel {
  for (const entry of SURFACE_LABELS) {
    if (entry.match.test(pathname)) return entry.data;
  }
  return { title: "This page is admin-only", surface: "This page" };
}

function tierWord(role: string | null): string {
  if (role === "standard") return "Standard";
  if (role === "freelance") return "Freelance";
  if (role === "pending") return "Pending";
  return "non-admin";
}

export function AdminRoute({ children }: { children: React.ReactNode }) {
  const { isAdmin, role, loading } = useUserRole();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex h-[40vh] items-center justify-center text-sm text-muted-foreground">
        Checking access…
      </div>
    );
  }

  if (!isAdmin) {
    const label = labelForPath(location.pathname);
    return (
      <PermissionDenied
        title={label.title}
        description={`Your account is a ${tierWord(role)} user. ${label.surface} is restricted to admins.`}
      />
    );
  }

  return <>{children}</>;
}
