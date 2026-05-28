import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TagInput } from "@/components/talent-scout/TagInput";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

/**
 * Phase 3.7.5 / 3.8: Talent Scout global settings page.
 *
 * Settings:
 *   - Global competitor list (default seed for new roles)
 *   - Anthropic monthly spend cap + current month spend display (read-only)
 *
 * The competitor list is the seed value for new roles' competitor_bonus.competitors
 * on creation. Editing here does NOT propagate to existing roles (per Jimmie's
 * spec); existing roles keep their saved list until edited via Role Settings.
 *
 * Spend tracking: callClaude in _shared/anthropic.ts increments
 * anthropic_spend_current_month_usd after every Claude call. Crossing the cap
 * fires a one-time email alert via _shared/sendEmail.ts to the oldest active
 * admin (cap_alert_sent_this_month gates re-fires; ts-cron-monthly-spend-reset
 * re-arms it on the 1st of each month). Calls are NOT blocked over cap —
 * graceful degradation per the spec.
 *
 * Storage maintenance is fully automated: ts-cron-storage-cleanup runs daily
 * at 03:00 UTC and purges per the conservative schema-doc retention rules.
 * No manual trigger surfaced to the UI.
 */
export default function TalentScoutSettings() {
  const [settingsId, setSettingsId] = useState<string | null>(null);

  // Competitor list state.
  const [competitors, setCompetitors] = useState<string[]>([]);
  const [competitorsInitial, setCompetitorsInitial] = useState<string[]>([]);

  // Spend cap state.
  const [capInput, setCapInput] = useState("");
  const [capInitial, setCapInitial] = useState("");
  const [currentSpend, setCurrentSpend] = useState(0);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data, error } = await supabase
        .from("global_settings")
        .select("id, talent_scout_competitor_list, anthropic_spend_cap_monthly_usd, anthropic_spend_current_month_usd")
        .limit(1)
        .maybeSingle();
      if (!active) return;
      if (error) {
        toast({ title: "Failed to load settings", description: error.message, variant: "destructive" });
        setLoading(false);
        return;
      }
      if (data) {
        setSettingsId(data.id);
        const list = data.talent_scout_competitor_list ?? [];
        setCompetitors(list);
        setCompetitorsInitial(list);
        const cap = String(data.anthropic_spend_cap_monthly_usd ?? 0);
        setCapInput(cap);
        setCapInitial(cap);
        setCurrentSpend(Number(data.anthropic_spend_current_month_usd ?? 0));
      }
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  const competitorsDirty =
    competitors.length !== competitorsInitial.length ||
    competitors.some((c, i) => c !== competitorsInitial[i]);
  const capDirty = capInput.trim() !== capInitial.trim();
  const dirty = competitorsDirty || capDirty;

  const onSave = async () => {
    if (!settingsId) return;
    const capNum = Number(capInput);
    if (!Number.isFinite(capNum) || capNum < 0) {
      toast({ title: "Invalid spend cap", description: "Enter a non-negative number.", variant: "destructive" });
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from("global_settings")
      .update({
        talent_scout_competitor_list: competitors,
        anthropic_spend_cap_monthly_usd: capNum,
      })
      .eq("id", settingsId);
    setSaving(false);
    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
      return;
    }
    setCompetitorsInitial(competitors);
    setCapInitial(String(capNum));
    setCapInput(String(capNum));
    toast({ title: "Settings saved" });
  };

  const onDiscard = () => {
    setCompetitors(competitorsInitial);
    setCapInput(capInitial);
  };

  const overCap = Number(capInitial || 0) > 0 && currentSpend >= Number(capInitial || 0);

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

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
          <span className="h-card">Anthropic Monthly Spend Cap (USD)</span>
        </div>
        <div className="card-pad space-y-3">
          <p className="text-xs text-muted-foreground">
            Crossing the cap fires a one-time email alert to the admin and re-arms on the 1st of each month. Calls keep running over cap (graceful degradation, not a hard cutoff).
          </p>
          <div className="flex items-center gap-4">
            <Input
              type="number"
              min={0}
              step="0.01"
              value={capInput}
              onChange={(e) => setCapInput(e.target.value)}
              className="max-w-[200px]"
            />
            <div className="text-[15px] text-muted-foreground">
              Current month spend:{" "}
              {/* Sanctioned coral: spend amount stays coral per Phase 5.13.2c spec. */}
              <span className="text-primary font-semibold text-[17px]">
                ${currentSpend.toFixed(2)}
              </span>
            </div>
          </div>
          {overCap && (
            <div className="text-xs text-destructive">
              Cap reached. Alert email already sent for this month.
            </div>
          )}
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
