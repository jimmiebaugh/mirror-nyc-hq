// Phase 5.12.14.3 R7 § F: VS Settings page build-out. Replaces the stub
// from Phase 5.12.12. Three section cards:
//   - F.1 Lookup Lists: CRUD on cities / neighborhoods / venue_types using
//     existing `useLookup` infra.
//   - F.2 Anthropic Spend Cap: writes `global_settings.anthropic_spend_cap_
//     monthly_usd`; displays current-period spend. Mirrors the Talent Scout
//     Settings UI pattern (`src/pages/talent-scout/Settings.tsx`). Per-tool
//     breakdown is deferred (no call-log infra exists yet; flagged in
//     OUTPUTS/REPO_DOC_UPDATES.md).
//   - F.3 System Prompts: placeholder only; editor lands in a future
//     sub-phase.
//
// Gated by AdminRoute (App.tsx:665). Producer + admin role discrimination
// is layered at the schema (RLS) layer; the page-level gate stays admin-
// only since the Spend Cap + future System Prompts editor are admin
// concerns.

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  LookupListsCard,
  type LookupListsCardEntry,
} from "@/components/settings/LookupListsCard";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

export default function ScoutGlobalSettings() {
  return (
    <div className="stack-6 mx-auto max-w-4xl pb-32">
      <header className="space-y-2">
        {/* R7 amendment v3 § 3: per-page back-crumb retired; TopBar
            carries it globally. */}
        <h1 className="h-page">Venue Scout Settings</h1>
        <p className="text-sm text-muted-foreground">
          Tool-app-wide configuration. Edits apply to every producer using
          Venue Scout.
        </p>
      </header>

      <LookupListsCard lookups={VS_LOOKUPS} title="Lookup Lists" />
      <SpendCapCard />
      <SystemPromptsCard />
    </div>
  );
}

// R7 amendment v1 § 6 → R7 amendment v2 § 3: VS Settings consumes the
// shared HQ Settings LookupListsCard (DRY with
// `src/pages/settings/SettingsPage.tsx`). Filtered to the 3 lookups that
// drive VS surfaces: cities + neighborhoods + venue_types. Neighborhoods
// renders inline inside the table's expanded row via the inline-mode
// NeighborhoodsLookupEditor (was a standalone card pre-R7 amendment v2).
const VS_LOOKUPS: LookupListsCardEntry[] = [
  {
    key: "cities",
    list: "Cities",
    usedBy: "VS brief intake City picker + scopes Neighborhoods",
  },
  {
    key: "neighborhoods",
    list: "Neighborhoods",
    usedBy: "VS brief intake Neighborhoods picker (scoped by city)",
  },
  {
    key: "venue_types",
    list: "Venue Types",
    usedBy: "VS brief intake Venue Type selector + matrix type pills",
  },
];

// ---------------------------------------------------------------------------
// F.2 — Anthropic Spend Cap card
// ---------------------------------------------------------------------------

function SpendCapCard() {
  const [settingsId, setSettingsId] = useState<string | null>(null);
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
        .select(
          "id, anthropic_spend_cap_monthly_usd, anthropic_spend_current_month_usd",
        )
        .limit(1)
        .maybeSingle();
      if (!active) return;
      if (error) {
        toast({
          title: "Failed to load spend cap",
          description: error.message,
          variant: "destructive",
        });
        setLoading(false);
        return;
      }
      if (data) {
        setSettingsId(data.id as string);
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

  const overCap =
    Number(capInitial || 0) > 0 && currentSpend >= Number(capInitial || 0);

  if (loading) {
    return (
      <section className="card">
        <div className="card-headbar">
          <h2 className="h-card">Anthropic Spend Cap</h2>
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
        <h2 className="h-card">Anthropic Spend Cap</h2>
      </div>
      <div className="card-pad space-y-4">
        <p className="text-xs text-muted-foreground">
          The monthly cap is shared across Talent Scout + Venue Scout (single
          `global_settings` row). Crossing the cap fires a one-time email
          alert to the admin and re-arms on the 1st of each month. Calls keep
          running over cap (graceful degradation, not a hard cutoff).
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
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                of ${Number(capInitial || 0).toFixed(2)} cap
              </span>
            </div>
          </div>
        </div>
        {overCap && (
          <div className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
            Cap reached. Alert email already sent for this month. Calls
            continue (graceful degradation).
          </div>
        )}

        {/* R7 § F.2 → R7 amendment v1 § 5: per-tool breakdown stub now
            sits above the Save button (was below). The call-log infra
            (per-edge-function row in an anthropic_call_log table or
            aggregation view) doesn't exist yet; queued via
            REPO_DOC_UPDATES. */}
        <div className="rounded-md border border-border bg-input/40 px-3 py-2">
          <p className="text-xs text-muted-foreground">
            Per-tool breakdown (calls + spend per edge function) coming when
            the call-log infrastructure ships. Tracking infra queued for a
            future sub-phase.
          </p>
        </div>

        <div className="flex justify-end">
          <Button disabled={!dirty || saving} onClick={() => void onSave()}>
            {saving ? "Saving…" : "Save spend cap"}
          </Button>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// F.3 — System Prompts placeholder
// ---------------------------------------------------------------------------

function SystemPromptsCard() {
  return (
    <section className="card">
      <div className="card-headbar">
        <h2 className="h-card">System Prompts</h2>
      </div>
      <div className="card-pad">
        <p className="text-sm text-muted-foreground">
          System prompts editor coming in a future sub-phase. The current
          per-function prompts live in `supabase/functions/vs-*` and can be
          edited via the codebase until this editor ships.
        </p>
      </div>
    </section>
  );
}
