import { useEffect } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useUserRole } from "@/hooks/useUserRole";
import Landing from "@/pages/Landing";
import { supabase } from "@/integrations/supabase/client";

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
  const { isPending, isDeactivated, loading: roleLoading } = useUserRole();
  const location = useLocation();

  // Phase 5.4: signed-in but `users.active = false` means admin deactivated.
  // Sign them out immediately and show a one-shot message before the redirect.
  useEffect(() => {
    if (isDeactivated) {
      supabase.auth.signOut().catch(() => undefined);
    }
  }, [isDeactivated]);

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
    // through Google; nav state doesn't. Phase 5.8.8: skip the write when
    // the URL is a failed-OAuth callback (carries `error=` in query OR
    // hash) — re-using that as a future redirect_uri causes Google to
    // reject the next sign-in with HTTP 400 and bricks the user.
    const intended = location.pathname + location.search;
    const looksLikeOAuthError =
      location.search.includes("error=") || location.hash.includes("error=");
    if (
      intended.startsWith("/") &&
      !intended.startsWith("//") &&
      !looksLikeOAuthError
    ) {
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

  if (isDeactivated) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-black px-6 text-center">
        <h1 className="text-lg font-semibold">Account deactivated</h1>
        <p className="text-muted-foreground max-w-md text-sm">
          An admin has deactivated your HQ access. Signing you out now. Reach out to
          a Mirror NYC admin if you think this is a mistake.
        </p>
      </div>
    );
  }

  if (isPending && !bypassPending) {
    return <Navigate to="/pending" replace state={{ from: location }} />;
  }

  return <>{children}</>;
}
