import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

type PermissionRole = Database["public"]["Enums"]["permission_role"];

type State = {
  role: PermissionRole | null;
  loading: boolean;
  isMember: boolean;
  isProducer: boolean;
  isAdmin: boolean;
};

const initial: State = {
  role: null,
  loading: true,
  isMember: false,
  isProducer: false,
  isAdmin: false,
};

/**
 * Reads the current authed user's permission_role from public.users.
 * Refetches when the user changes (sign-in / sign-out).
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
      .select("permission_role")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!active) return;
        const role = (data?.permission_role ?? null) as PermissionRole | null;
        setState({
          role,
          loading: false,
          isMember: role === "member" || role === "producer" || role === "admin",
          isProducer: role === "producer" || role === "admin",
          isAdmin: role === "admin",
        });
      });
    return () => {
      active = false;
    };
  }, [user?.id]);

  return state;
}
