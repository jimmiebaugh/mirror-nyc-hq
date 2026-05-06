import { Navigate, useLocation } from "react-router-dom";
import { useUserRole } from "@/hooks/useUserRole";

/**
 * Gate for admin-only routes. Renders children when the current user is an
 * admin per public.users.permission_role. Redirects elsewhere otherwise.
 *
 * Mounted INSIDE ProtectedRoute, so we can assume the user is authenticated.
 */
export function AdminRoute({ children }: { children: React.ReactNode }) {
  const { isAdmin, loading } = useUserRole();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex h-[40vh] items-center justify-center text-sm text-muted-foreground">
        Checking access…
      </div>
    );
  }

  if (!isAdmin) {
    return <Navigate to="/" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}
