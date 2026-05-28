import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { AnthropicSpendBreakdownTable } from "./AnthropicSpendBreakdownTable";

type BreakdownRow = {
  app: "talent_scout" | "venue_scout" | "hq";
  fn_name: string;
  calls: number;
  total_cost_usd: number;
  avg_cost_usd: number;
};

/**
 * HQ Admin Settings: Anthropic spend card.
 *
 * Canonical home for the monthly cap input (Phase 5.15 consolidated TS +
 * VS Settings cap inputs onto this single admin surface). Reads + writes
 * `global_settings.anthropic_spend_cap_monthly_usd`. Displays the
 * current-window spend and a per-tool breakdown below.
 *
 * Window selector (Phase 5.15.3): Month / Year segmented toggle in the
 * breakdown header row controls both the breakdown table AND the
 * "Current Period Spend" display. Under Month, the display reads
 * "$X.XX of $Y.XX cap" against the monthly cap. Under Year, it reads
 * "$X.XX of $Y.XX annualized" against monthly cap × 12. The cap input
 * itself stays monthly; only the comparison reference frame scales.
 * Spend total derives from the breakdown RPC (sum over all returned
 * rows) so it picks up the wider window automatically.
 *
 * The cap is shared across all three apps (TS + VS + HQ) -- it lives on
 * the single `global_settings` row. Crossing the cap fires a one-time
 * email alert; calls keep running (graceful degradation, not a hard
 * cutoff).
 */
export function AnthropicSpendCapCard() {
  const [settingsId, setSettingsId] = useState<string | null>(null);
  const [capInput, setCapInput] = useState("");
  const [capInitial, setCapInitial] = useState("");
  const [currentSpend, setCurrentSpend] = useState(0);
  const [window, setWindow] = useState<"month" | "year">("month");
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
            .select("id, anthropic_spend_cap_monthly_usd")
            .limit(1)
            .maybeSingle(),
          supabase.rpc("anthropic_spend_breakdown", { window_kind: window }),
        ]);
      if (!active) return;
      if (gsErr) {
        toast({
          title: "Failed to load spend cap",
          description: gsErr.message,
          variant: "destructive",
        });
        setLoading(false);
        return;
      }
      if (gs) {
        setSettingsId(gs.id as string);
        const cap = String(gs.anthropic_spend_cap_monthly_usd ?? 0);
        setCapInput(cap);
        setCapInitial(cap);
      }
      if (rpcErr) {
        toast({
          title: "Couldn't load spend",
          description: rpcErr.message,
          variant: "destructive",
        });
        setCurrentSpend(0);
      } else {
        const all = (rows ?? []) as BreakdownRow[];
        const total = all.reduce(
          (acc, r) => acc + Number(r.total_cost_usd ?? 0),
          0,
        );
        setCurrentSpend(total);
      }
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [window]);

  const dirty = capInput.trim() !== capInitial.trim();

  const onSave = async () => {
    if (!settingsId) return;
    const capNum = Number(capInput);
    if (!Number.isFinite(capNum) || capNum < 0) {
      toast({
        title: "Invalid spend cap",
        description: "Enter a non-negative number.",
        variant: "destructive",
      });
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from("global_settings")
      .update({ anthropic_spend_cap_monthly_usd: capNum })
      .eq("id", settingsId);
    setSaving(false);
    if (error) {
      toast({
        title: "Save failed",
        description: error.message,
        variant: "destructive",
      });
      return;
    }
    setCapInitial(String(capNum));
    setCapInput(String(capNum));
    toast({ title: "Spend cap saved" });
  };

  const monthlyCap = Number(capInitial || 0);
  const referenceCap = window === "year" ? monthlyCap * 12 : monthlyCap;
  const referenceLabel = window === "year" ? "annualized" : "cap";
  const overCap = referenceCap > 0 && currentSpend >= referenceCap;

  if (loading) {
    return (
      <section className="card">
        <div className="card-headbar">
          <h2 className="h-card">Anthropic Spend</h2>
        </div>
        <div className="card-pad">
          <p className="text-sm text-muted-foreground">Loading…</p>
        </div>
      </section>
    );
  }

  return (
    <section className="card">
      <div className="card-headbar">
        <h2 className="h-card">Anthropic Spend</h2>
      </div>
      <div className="card-pad space-y-4">
        <p className="text-xs text-muted-foreground">
          Monthly cap is shared across Talent Scout, Venue Scout, and HQ Core.
          Crossing the cap fires an email alert, calls keep running over cap.
        </p>
        <div className="flex flex-wrap items-center gap-4">
          <div className="space-y-1">
            <div className="label-form">Monthly Cap (USD)</div>
            <Input
              type="number"
              min={0}
              step="0.01"
              value={capInput}
              onChange={(e) => setCapInput(e.target.value)}
              className="max-w-[200px]"
            />
          </div>
          <div className="space-y-1">
            <div className="label-form">Current Period Spend</div>
            <div className="text-[17px] font-bold text-primary">
              ${currentSpend.toFixed(2)}
              {referenceCap > 0 && (
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  of ${referenceCap.toFixed(2)} {referenceLabel}
                </span>
              )}
            </div>
          </div>
        </div>
        {overCap && (
          <div className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
            Cap reached. Alert email already sent for this month. Calls
            continue (graceful degradation).
          </div>
        )}
        <div className="flex justify-end">
          <Button disabled={!dirty || saving} onClick={() => void onSave()}>
            {saving ? "Saving…" : "Save spend cap"}
          </Button>
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
          <AnthropicSpendBreakdownTable window={window} />
        </div>
      </div>
    </section>
  );
}
