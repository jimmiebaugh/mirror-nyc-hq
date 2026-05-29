import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

type PermissionRole = Database["public"]["Enums"]["permission_role"];

type State = {
  role: PermissionRole | null;
  loading: boolean;
  isAdmin: boolean;
  isStandard: boolean;
  isFreelance: boolean;
  isPending: boolean;
  /**
   * True for any non-pending, active user (admin / standard / freelance).
   * Phase 5.16.0 added; mirrors the DB-side `is_active_member()` predicate
   * that now gates HQ Core RLS. Replaced `isStandardOrAdmin` when freelance
   * was flattened to functional equality with standard.
   */
  isActiveMember: boolean;
  /** True when the row exists and `active = false`. Phase 5.4 added. */
  isDeactivated: boolean;
  /**
   * True when `users.is_owner = true`. Phase 5.6.5 added. Gates the
   * "Save as default for all users" affordance on `<SavedViewsDropdown>`
   * and the calendar visibility panel.
   */
  isOwner: boolean;
};

const initial: State = {
  role: null,
  loading: true,
  isAdmin: false,
  isStandard: false,
  isFreelance: false,
  isPending: false,
  isActiveMember: false,
  isDeactivated: false,
  isOwner: false,
};

/**
 * Reads the current authed user's permission_role from public.users.
 * Refetches when the user changes (sign-in / sign-out).
 *
 * Phase 5.1 tier model: admin / standard / freelance / pending. Pending
 * users are redirected to /pending upstream by `<ProtectedRoute>`. Phase
 * 5.16.0 flattened freelance to functional equality with standard; the
 * `isActiveMember` flag (= any non-pending active user) replaced the old
 * `isStandardOrAdmin` flag that gated the now-deleted `StandardOrAdminRoute`.
 */
export function useUserRole(): State {
  const { user } = useAuth();
  const userId = user?.id;
  const [state, setState] = useState<State>(initial);

  useEffect(() => {
    let active = true;
    if (!userId) {
      setState({ ...initial, loading: false });
      return;
    }
    setState((s) => ({ ...s, loading: true }));
    supabase
      .from("users")
      .select("permission_role, active, is_owner")
      .eq("id", userId)
      .maybeSingle()
      .then(({ data }) => {
        if (!active) return;
        const role = (data?.permission_role ?? null) as PermissionRole | null;
        const isActive = data?.active ?? true;
        setState({
          role,
          loading: false,
          isAdmin: role === "admin",
          isStandard: role === "standard",
          isFreelance: role === "freelance",
          // Safety net (Phase 5.16.1.1, Frontend #49): an authed user whose
          // `public.users` row is unreadable resolves `role` to null. Treat
          // null-role as pending so `<ProtectedRoute>` redirects to /pending
          // instead of letting every flag fall through to false (which would
          // silently skip the redirect). 5.16.0's `users_select` self-read
          // clause is the primary guard; this is the defensive backstop.
          isPending: role === "pending" || role === null,
          isActiveMember: role !== null && role !== "pending" && isActive,
          isDeactivated: data != null && !isActive,
          isOwner: data?.is_owner === true,
        });
      });
    return () => {
      active = false;
    };
  }, [userId]);

  return state;
}
