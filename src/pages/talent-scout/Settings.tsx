import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { TagInput } from "@/components/talent-scout/TagInput";
import { AnthropicSpendBreakdownTable } from "@/components/settings/AnthropicSpendBreakdownTable";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

/**
 * Talent Scout global settings page.
 *
 * Settings:
 *   - Global competitor list (default seed for new roles). Editing here
 *     does NOT propagate to existing roles; existing roles keep their
 *     saved list until edited via Role Settings.
 *   - Anthropic Spend (read-only, Phase 5.15; per-function breakdown
 *     table added Phase 5.15.1; Month / Year window toggle added Phase
 *     5.15.3). TS spend + global spend for the selected window, plus
 *     the per-function breakdown filtered to `app='talent_scout'`. Both
 *     summary numbers derive from the breakdown RPC so they scale with
 *     the toggle. Cap editing + the grouped full-pool breakdown live on
 *     HQ Admin Settings (canonical home).
 *
 * Spend tracking: callClaude in _shared/anthropic.ts increments
 * `global_settings.anthropic_spend_current_month_usd` after every Claude
 * call AND writes a per-call row to `anthropic_call_log` (Phase 5.15).
 * Cap-alert wiring lives unchanged on _shared/anthropic.ts; the cap value
 * is now editable only on HQ Admin Settings.
 *
 * Storage maintenance is fully automated: ts-cron-storage-cleanup runs
 * daily at 03:00 UTC; ts-cron-monthly-spend-reset resets spend + prunes
 * 12-month-old call-log rows on the 1st (Phase 5.15).
 */
type BreakdownRow = {
  app: "talent_scout" | "venue_scout" | "hq";
  fn_name: string;
  calls: number;
  total_cost_usd: number;
  avg_cost_usd: number;
};

export default function TalentScoutSettings() {
  const [settingsId, setSettingsId] = useState<string | null>(null);

  // Competitor list state.
  const [competitors, setCompetitors] = useState<string[]>([]);
  const [competitorsInitial, setCompetitorsInitial] = useState<string[]>([]);

  // Spend display state (read-only as of 5.15; window-toggleable as of 5.15.3).
  const [window, setWindow] = useState<"month" | "year">("month");
  const [tsSpend, setTsSpend] = useState(0);
  const [globalSpend, setGlobalSpend] = useState(0);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      const [{ data: gs, error: gsErr }, { data: rows, error: rpcErr }] =
        await Promise.all([
          supabase
            .from("global_settings")
            .select("id, talent_scout_competitor_list")
            .limit(1)
            .maybeSingle(),
          supabase.rpc("anthropic_spend_breakdown", { window_kind: window }),
        ]);
      if (!active) return;
      if (gsErr) {
        toast({ title: "Failed to load settings", description: gsErr.message, variant: "destructive" });
        setLoading(false);
        return;
      }
      if (gs) {
        setSettingsId(gs.id);
        const list = gs.talent_scout_competitor_list ?? [];
        setCompetitors(list);
        setCompetitorsInitial(list);
      }
      if (rpcErr) {
        toast({
          title: "Couldn't load TS spend breakdown",
          description: rpcErr.message,
          variant: "destructive",
        });
        setTsSpend(0);
        setGlobalSpend(0);
      } else {
        const all = (rows ?? []) as BreakdownRow[];
        const tsTotal = all
          .filter((r) => r.app === "talent_scout")
          .reduce((acc, r) => acc + Number(r.total_cost_usd ?? 0), 0);
        const globalTotal = all.reduce(
          (acc, r) => acc + Number(r.total_cost_usd ?? 0),
          0,
        );
        setTsSpend(tsTotal);
        setGlobalSpend(globalTotal);
      }
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [window]);

  const competitorsDirty =
    competitors.length !== competitorsInitial.length ||
    competitors.some((c, i) => c !== competitorsInitial[i]);
  const dirty = competitorsDirty;

  const onSave = async () => {
    if (!settingsId) return;
    setSaving(true);
    const { error } = await supabase
      .from("global_settings")
      .update({ talent_scout_competitor_list: competitors })
      .eq("id", settingsId);
    setSaving(false);
    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
      return;
    }
    setCompetitorsInitial(competitors);
    toast({ title: "Settings saved" });
  };

  const onDiscard = () => {
    setCompetitors(competitorsInitial);
  };

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  const windowLabel = window === "year" ? "this year" : "this month";

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="space-y-2">
        <h1 className="h-page">Talent Scout Settings</h1>
      </header>

      <section className="card">
        <div className="card-headbar">
          <span className="h-card">Global Competitor List</span>
        </div>
        <div className="card-pad space-y-3">
          <p className="text-xs text-muted-foreground">
            Used as the default competitor pool for newly created roles. Hit Enter or Tab to add a tag. Changes here apply to future roles only. Existing roles keep their saved competitor list until you edit it on Role Settings.
          </p>
          <TagInput
            value={competitors}
            onChange={setCompetitors}
            placeholder="Add competitor…"
            caseInsensitiveDedup
          />
        </div>
      </section>

      <section className="card">
        <div className="card-headbar">
          <span className="h-card">Anthropic Spend</span>
        </div>
        <div className="card-pad space-y-3">
          <p className="text-xs text-muted-foreground">
            Talent Scout's contribution to the selected window's Anthropic spend. Cap
            and full per-tool breakdown live on the HQ Admin Settings page.
          </p>
          <div className="flex flex-wrap items-center gap-6">
            <div>
              <div className="label-form">Talent Scout ({windowLabel})</div>
              <div className="text-[17px] font-bold text-primary">
                ${tsSpend.toFixed(2)}
              </div>
            </div>
            <div>
              <div className="label-form">Global ({windowLabel})</div>
              <div className="text-[17px] font-bold text-primary">
                ${globalSpend.toFixed(2)}
              </div>
            </div>
          </div>
          <div className="space-y-3 pt-3 border-t border-border">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <h2 className="h-card" style={{ fontSize: 15 }}>Per-tool breakdown</h2>
              <div className="viewswitch" role="tablist" aria-label="Spend window">
                <button
                  type="button"
                  role="tab"
                  aria-selected={window === "month"}
                  className={window === "month" ? "on" : undefined}
                  onClick={() => setWindow("month")}
                >
                  Month
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={window === "year"}
                  className={window === "year" ? "on" : undefined}
                  onClick={() => setWindow("year")}
                >
                  Year
                </button>
              </div>
            </div>
            <AnthropicSpendBreakdownTable appFilter="talent_scout" window={window} />
          </div>
        </div>
      </section>

      <div className="flex items-center justify-end gap-3">
        <Button variant="outline" disabled={!dirty || saving} onClick={onDiscard}>
          Discard changes
        </Button>
        <Button disabled={!dirty || saving} onClick={onSave}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}
