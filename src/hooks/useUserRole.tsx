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
  isStandardOrAdmin: boolean;
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
  isStandardOrAdmin: false,
  isDeactivated: false,
  isOwner: false,
};

/**
 * Reads the current authed user's permission_role from public.users.
 * Refetches when the user changes (sign-in / sign-out).
 *
 * Phase 5.1 tier model: admin / standard / freelance / pending. The
 * `isStandardOrAdmin` flag drives `<StandardOrAdminRoute>` access; pending
 * users are redirected to /pending upstream by `<ProtectedRoute>`.
 */
export function useUserRole(): State {
  const { user } = useAuth();
  const [state, setState] = useState<State>(initial);

  useEffect(() => {
    let active = true;
    if (!user) {
      setState({ ...initial, loading: false });
      return;
    }
    setState((s) => ({ ...s, loading: true }));
    supabase
      .from("users")
      .select("permission_role, active, is_owner")
      .eq("id", user.id)
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
          isPending: role === "pending",
          isStandardOrAdmin: role === "admin" || role === "standard",
          isDeactivated: data != null && !isActive,
          isOwner: data?.is_owner === true,
        });
      });
    return () => {
      active = false;
    };
  }, [user?.id]);

  return state;
}
