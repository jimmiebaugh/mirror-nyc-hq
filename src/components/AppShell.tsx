import { useEffect, useState } from "react";
import { Outlet } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useUserRole } from "@/hooks/useUserRole";
import { supabase } from "@/integrations/supabase/client";
import { LeftRail } from "@/components/shell/LeftRail";
import { TopBar } from "@/components/shell/TopBar";

/**
 * Phase 5.1 AppShell. Wraps every authenticated route beyond /pending.
 *
 * Replaces the shipped top-nav shell with the locked left-rail + slim top
 * bar layout (spec § 6). Mounted INSIDE `<ProtectedRoute>`, so the user is
 * authenticated and not pending by the time this renders. The Standard /
 * Admin tier branch happens here (driving rail variant) plus inside the
 * Home page; freelance + pending users never see this component.
 */
export default function AppShell() {
  const { user } = useAuth();
  const { isAdmin, isFreelance } = useUserRole();
  const [tasksOpenCount, setTasksOpenCount] = useState(0);

  // Tasks rail badge count: open tasks assigned to the signed-in user. One
  // query on mount is enough for 5.1; the Tasks list page (5.2) refetches
  // on navigation. No realtime subscription per spec § 6d recommendation.
  useEffect(() => {
    let active = true;
    if (!user?.id) return;
    supabase
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("assignee_id", user.id)
      .in("status", ["To Do", "Doing"])
      .then(({ count }) => {
        if (!active) return;
        setTasksOpenCount(count ?? 0);
      });
    return () => {
      active = false;
    };
  }, [user?.id]);

  const email = user?.email ?? "";
  const fullName = ((user?.user_metadata ?? {}) as Record<string, string>).full_name
    ?? ((user?.user_metadata ?? {}) as Record<string, string>).name
    ?? null;
  const avatarUrl = ((user?.user_metadata ?? {}) as Record<string, string>).avatar_url ?? null;

  const tier: "Admin" | "Standard" | "Freelance" = isAdmin
    ? "Admin"
    : isFreelance
      ? "Freelance"
      : "Standard"; // Default catches Standard plus any role-unresolved race (pending users are gated upstream)

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      <LeftRail
        isAdmin={isAdmin}
        tasksOpenCount={tasksOpenCount}
        fullName={fullName}
        email={email}
        tier={tier}
        avatarUrl={avatarUrl}
      />
      <div className="flex flex-col flex-1 min-w-0">
        <TopBar fullName={fullName} email={email} avatarUrl={avatarUrl} />
        <main className="hq-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}