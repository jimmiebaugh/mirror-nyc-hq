import { useEffect, useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { Download, Loader2, Settings as SettingsIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { RoleStatusPill } from "@/components/talent-scout/RoleStatusPill";
import { toast } from "@/hooks/use-toast";
import type { Database } from "@/integrations/supabase/types";
import { cn } from "@/lib/utils";

type RoleRow = Database["public"]["Tables"]["ts_roles"]["Row"];
type Role = RoleRow & {
  hiring_manager: { full_name: string | null; email: string } | null;
};

type Criterion = {
  name: string;
  tier: 1 | 2 | 3;
  weight: number;
  is_disqualifier?: boolean;
  full_points_rubric?: string;
  partial_points_rubric?: string;
  is_manual?: boolean;
};

const TIER_LABEL = {
  1: "Tier 1 — Must-Haves",
  2: "Tier 2 — Strong Differentiators",
  3: "Tier 3 — Nice-to-Haves",
} as const;

const TIER_COLOR = {
  1: "bg-red-500/10 border-red-500/30 text-red-400",
  2: "bg-amber-500/10 border-amber-500/30 text-amber-400",
  3: "bg-emerald-500/10 border-emerald-500/30 text-emerald-400",
} as const;

const SCHEDULE_LABEL: Record<string, string> = {
  off: "Off (manual only)",
  daily: "Daily",
  every_3_days: "Every 3 days",
  weekly: "Weekly",
};

export default function RoleDashboard() {
  const { id } = useParams();
  const nav = useNavigate();
  const [role, setRole] = useState<Role | null>(null);
  const [loading, setLoading] = useState(true);
  const [runningRoundId, setRunningRoundId] = useState<string | null>(null);
  const [pulling, setPulling] = useState(false);

  useEffect(() => {
    if (!id) return;
    let active = true;
    (async () => {
      const [{ data: r }, { data: rr }] = await Promise.all([
        supabase
          .from("ts_roles")
          .select("*, hiring_manager:users!ts_roles_hiring_manager_id_fkey(full_name, email)")
          .eq("id", id)
          .maybeSingle(),
        supabase
          .from("ts_pull_rounds")
          .select("id")
          .eq("role_id", id)
          .eq("status", "running")
          .order("started_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      if (!active) return;
      setRole((r as unknown as Role) ?? null);
      setRunningRoundId((rr?.id as string | undefined) ?? null);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [id]);

  const startPull = async () => {
    if (!id) return;
    setPulling(true);
    const { data, error } = await supabase.functions.invoke<{ pull_round_id?: string; error?: string }>(
      "ts-pull-candidates",
      { body: { role_id: id, triggered_by: "manual" } },
    );
    setPulling(false);
    const errMsg = error?.message ?? data?.error ?? null;
    if (errMsg || !data?.pull_round_id) {
      toast({
        title: "Couldn't start pull",
        description: errMsg ?? "No pull_round_id returned",
        variant: "destructive",
      });
      return;
    }
    nav(`/talent-scout/roles/${id}/pulls/${data.pull_round_id}`);
  };

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!role) {
    return (
      <Card>
        <CardContent className="space-y-3 p-8 text-center">
          <p className="text-sm">Role not found.</p>
          <Button variant="ghost" onClick={() => nav("/talent-scout")}>← Back to roles</Button>
        </CardContent>
      </Card>
    );
  }

  const criteria = (role.scorecard as unknown as Criterion[]) ?? [];
  const totalWeight = criteria.reduce((s, c) => s + (Number(c.weight) || 0), 0);
  const competitorBonus = (role.competitor_bonus as { competitors?: string[]; bonus_points?: number } | null) ?? null;
  const managerLabel = role.hiring_manager?.full_name ?? role.hiring_manager?.email ?? "Unassigned";

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between gap-5">
        <div className="space-y-2">
          <Link to="/talent-scout" className="text-xs uppercase tracking-widest text-primary hover:underline">
            ← Talent Scout
          </Link>
          <h1 className="text-3xl font-semibold tracking-tight">{role.title}</h1>
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <RoleStatusPill status={role.status} />
            <span>·</span>
            <span>Hiring manager: {managerLabel}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {role.status === "open" && (
            runningRoundId ? (
              <Button asChild variant="default">
                <Link to={`/talent-scout/roles/${role.id}/pulls/${runningRoundId}`}>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  View running pull
                </Link>
              </Button>
            ) : (
              <Button onClick={startPull} disabled={pulling}>
                <Download className="mr-2 h-4 w-4" />
                {pulling ? "Starting…" : "Pull candidates"}
              </Button>
            )
          )}
          <Button asChild variant="outline">
            <Link to={`/talent-scout/roles/${role.id}/settings`}>
              <SettingsIcon className="mr-2 h-4 w-4" />
              Edit role
            </Link>
          </Button>
        </div>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardContent className="space-y-4 p-5">
            <SectionTitle>Role details</SectionTitle>
            <KeyValue k="Location" v={role.location} />
            <KeyValue k="Type" v={role.type} />
            <KeyValue k="Compensation" v={role.compensation} />
            <KeyValue k="Auto-rejection threshold" v={`${role.auto_rejection_threshold ?? 0} / 100`} />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-4 p-5">
            <SectionTitle>Email pull</SectionTitle>
            <KeyValue
              k="Subject keywords"
              v={role.email_keywords?.length ? role.email_keywords.join(", ") : "—"}
            />
            <KeyValue
              k="Search start"
              v={role.email_search_start_date ?? "—"}
            />
            <KeyValue
              k="Auto-pull schedule"
              v={SCHEDULE_LABEL[role.auto_pull_schedule] ?? role.auto_pull_schedule}
            />
          </CardContent>
        </Card>
      </div>

      {role.hiring_priorities && (
        <Card>
          <CardContent className="space-y-2 p-5">
            <SectionTitle>Hiring priorities (not in JD)</SectionTitle>
            <p className="whitespace-pre-line text-sm text-muted-foreground">{role.hiring_priorities}</p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="space-y-4 p-5">
          <div className="flex items-end justify-between">
            <SectionTitle>Scorecard ({criteria.length} criteria)</SectionTitle>
            <span className="text-xs text-muted-foreground">
              Total weight: <strong className="text-foreground">{totalWeight} pts</strong>
              {competitorBonus?.bonus_points ? ` + ${competitorBonus.bonus_points} bonus` : ""}
            </span>
          </div>
          {([1, 2, 3] as const).map((tier) => {
            const items = criteria.filter((c) => c.tier === tier);
            if (items.length === 0) return null;
            return (
              <div key={tier} className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className={cn("inline-flex items-center rounded-sm border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider", TIER_COLOR[tier])}>
                    {TIER_LABEL[tier]}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {items.reduce((s, c) => s + (Number(c.weight) || 0), 0)} pts
                  </span>
                </div>
                <ul className="divide-y divide-border rounded-md border border-border">
                  {items.map((c, i) => (
                    <li key={i} className="flex items-start justify-between gap-4 px-4 py-3 text-sm">
                      <div className="space-y-1">
                        <div className="font-medium">{c.name}</div>
                        {c.full_points_rubric && (
                          <div className="text-xs text-muted-foreground">{c.full_points_rubric}</div>
                        )}
                      </div>
                      <div className="whitespace-nowrap text-sm font-bold">{c.weight} pts</div>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card className="border-dashed">
        <CardContent className="px-5 py-10 text-center">
          <p className="text-sm text-muted-foreground">
            No candidates pulled yet. Pull pipeline lands in Phase 3.4.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] font-bold uppercase tracking-wider text-primary">{children}</div>
  );
}

function KeyValue({ k, v }: { k: string; v: string | number | null | undefined }) {
  return (
    <div className="flex items-baseline justify-between gap-4 text-sm">
      <span className="text-xs uppercase tracking-wider text-muted-foreground">{k}</span>
      <span className="text-right font-medium">{v ?? "—"}</span>
    </div>
  );
}
