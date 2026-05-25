import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { IconClock } from "@/components/icons/HQIcons";

/**
 * Phase 5.1 Surface 01 (pending) per spec § 4.
 *
 * Renders a bare full-viewport centered card. No shell. Polls public.users
 * every 30s for the signed-in user's permission_role; on a non-pending value,
 * hard-navigates to /home (window.location.assign) so AuthProvider +
 * useUserRole re-mount and refetch the role cleanly. A React-Router-only
 * navigate keeps useUserRole's cached `isPending: true` and would put the
 * user in a redirect loop with ProtectedRoute.
 *
 * Locked path: 30s poll. Realtime publication add deferred per Q4 of the
 * locked-decisions memo.
 */
export default function PendingState() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const email = user?.email ?? "";

  // 30-second poll on the signed-in user's row.
  useEffect(() => {
    if (!user?.id) return;
    const interval = setInterval(async () => {
      const { data } = await supabase
        .from("users")
        .select("permission_role")
        .eq("id", user.id)
        .maybeSingle();
      const nextRole = data?.permission_role;
      if (nextRole && nextRole !== "pending") {
        // Force a full page reload so useUserRole refetches; a React-Router
        // navigate would keep the stale `isPending: true` state and re-bounce.
        window.location.assign("/home");
      }
    }, 30_000);
    return () => clearInterval(interval);
  }, [user?.id]);

  const handleSignOut = async () => {
    await signOut();
    navigate("/", { replace: true });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="mx-auto w-full max-w-md rounded-[4px] border border-border bg-surface-alt p-8 text-center">
        <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-full border border-[hsl(var(--border-strong))] bg-surface-raised text-primary">
          <IconClock className="h-[22px] w-[22px]" />
        </div>
        <h3 className="text-[18px] font-extrabold uppercase" style={{ fontFamily: "var(--font-display)" }}>
          Your account is pending
        </h3>
        <p className="mt-3 text-sm text-muted-foreground">
          You signed in with{" "}
          <b className="text-foreground">{email}</b>, but there is no Team record
          linked to it yet. An admin needs to assign your access tier before you
          can use HQ.
        </p>
        <p className="mt-4 text-[11px] font-mono text-[hsl(var(--subtle-foreground))]">
          Admins have been notified and will approve access.
        </p>
        <button
          type="button"
          onClick={handleSignOut}
          className="btn btn-secondary mt-5"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}