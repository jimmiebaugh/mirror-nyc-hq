import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import Landing from "@/pages/Landing";

/**
 * Auth gate for the AppShell layout. When unauthenticated:
 *   - at /     → render the stealth Landing inline (full-screen, no shell)
 *   - elsewhere → redirect to / (which then renders Landing)
 *
 * The hidden sign-in trigger lives on Landing, so there's no /login route to
 * leak. Authenticated users get the AppShell + nested Outlet as normal.
 */
export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black">
        <div className="text-muted-foreground text-sm">Loading…</div>
      </div>
    );
  }

  if (!user) {
    if (location.pathname === "/") return <Landing />;
    return <Navigate to="/" replace state={{ from: location }} />;
  }

  return <>{children}</>;
}
