import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useUserRole } from "@/hooks/useUserRole";
import Landing from "@/pages/Landing";

/**
 * Auth gate for the AppShell layout. When unauthenticated:
 *   - at /     → render the stealth Landing inline (full-screen, no shell)
 *   - elsewhere → save the intended URL to sessionStorage (so the OAuth
 *     redirectTo can land the user back on it after sign-in) and redirect
 *     to / which renders Landing with the hidden sign-in trigger.
 *
 * Phase 5.1: when the signed-in user's permission_role is `pending`, redirect
 * to /pending so admins assign a tier before any shell route renders. The
 * /pending route itself wraps in ProtectedRoute but skips the pending redirect
 * via the `bypassPending` flag below.
 */
const POST_SIGNIN_REDIRECT_KEY = "post_signin_redirect";

export function ProtectedRoute({
  children,
  bypassPending = false,
}: {
  children: React.ReactNode;
  bypassPending?: boolean;
}) {
  const { user, loading } = useAuth();
  const { isPending, loading: roleLoading } = useUserRole();
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
    // Capture the intended destination so signInWithGoogle can pass it as
    // the OAuth redirectTo. sessionStorage survives the OAuth round-trip
    // through Google; nav state doesn't.
    const intended = location.pathname + location.search + location.hash;
    if (intended.startsWith("/") && !intended.startsWith("//")) {
      try {
        sessionStorage.setItem(POST_SIGNIN_REDIRECT_KEY, intended);
      } catch {
        /* private mode / quota exceeded; fall through */
      }
    }
    return <Navigate to="/" replace state={{ from: location }} />;
  }

  if (roleLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black">
        <div className="text-muted-foreground text-sm">Loading…</div>
      </div>
    );
  }

  if (isPending && !bypassPending) {
    return <Navigate to="/pending" replace state={{ from: location }} />;
  }

  return <>{children}</>;
}
