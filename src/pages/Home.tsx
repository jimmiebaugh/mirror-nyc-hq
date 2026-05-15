import { useAuth } from "@/hooks/useAuth";
import { useUserRole } from "@/hooks/useUserRole";
import { Greeting } from "@/components/home/Greeting";
import { MyWeekStrip } from "@/components/home/MyWeekStrip";
import { PipelineCountsRow } from "@/components/home/PipelineCountsRow";
import { MyProjectsCard } from "@/components/home/MyProjectsCard";
import { MyTasksThisWeekCard } from "@/components/home/MyTasksThisWeekCard";
import { AllActiveProjectsCard } from "@/components/home/AllActiveProjectsCard";
import { OutlookCondensedCard } from "@/components/home/OutlookCondensedCard";
import { RecentActivityCard } from "@/components/home/RecentActivityCard";

/**
 * Phase 5.1 Home page. Surface 02 (Standard) + Surface 03 (Admin) per spec
 * § 7. Tier-branching happens at the section level so the page is a single
 * component instead of two near-duplicates.
 *
 * All hooks live above the conditional render path per
 * `docs/design-system.md` § 12.1.
 */
export default function Home() {
  const { user } = useAuth();
  const { isAdmin } = useUserRole();
  const meta = (user?.user_metadata ?? {}) as Record<string, string | undefined>;
  const fullName = meta.full_name ?? meta.name ?? null;
  const email = user?.email ?? "";
  const userId = user?.id;

  return (
    <div className="space-y-6">
      <Greeting fullName={fullName} email={email} />
      {isAdmin ? <PipelineCountsRow /> : null}
      <MyWeekStrip userId={userId} />
      {isAdmin ? (
        <MyProjectsCard userId={userId} fullWidth />
      ) : (
        <div className="grid grid-cols-2 gap-4 items-start">
          <MyProjectsCard userId={userId} />
          <MyTasksThisWeekCard userId={userId} />
        </div>
      )}
      <AllActiveProjectsCard />
      {isAdmin ? <OutlookCondensedCard /> : null}
      <RecentActivityCard
        userId={userId}
        scope={isAdmin ? "cross-team" : "mine"}
      />
    </div>
  );
}