import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useUserRole } from "@/hooks/useUserRole";

/**
 * Gate for HQ Core routes that require Standard or Admin tier (every authed
 * route beyond /pending and the Talent-Scout admin pages). Mounted INSIDE
 * ProtectedRoute, so the user is authenticated and not pending by the time
 * this renders.
 *
 * Freelance users land on a friendly empty state with a Sign Out button.
 */
export function StandardOrAdminRoute({ children }: { children: React.ReactNode }) {
  const { isStandardOrAdmin, loading } = useUserRole();
  const { signOut } = useAuth();
  const navigate = useNavigate();

  if (loading) {
    return (
      <div className="flex h-[40vh] items-center justify-center text-sm text-muted-foreground">
        Checking access...
      </div>
    );
  }

  if (!isStandardOrAdmin) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-24 text-center">
        <h2 className="h-section">Access restricted</h2>
        <p className="max-w-md text-sm text-muted-foreground">
          This page is not part of your access tier. If you think that is wrong,
          ping an admin.
        </p>
        <button
          type="button"
          className="btn-ghost"
          onClick={async () => {
            await signOut();
            navigate("/");
          }}
        >
          Sign out
        </button>
      </div>
    );
  }

  return <>{children}</>;
}