// VS Settings page. Three section cards:
//   - Lookup Lists: CRUD on cities / neighborhoods / venue_types using
//     existing `useLookup` infra.
//   - Anthropic Spend (read-only as of Phase 5.15; per-function breakdown
//     table added Phase 5.15.1; Month / Year window toggle added Phase
//     5.15.3): VS spend + global spend for the selected window. Both
//     summary numbers derive from the breakdown RPC so they scale with
//     the toggle. Cap editing + the grouped full-pool breakdown live on
//     HQ Admin Settings (canonical home).
//   - System Prompts: placeholder only; editor lands in a future
//     sub-phase.
//
// Gated by AdminRoute. Phase 5.16 will revisit RLS posture across HQ Core
// tables; the page-level gate stays admin-only until that pass.

import { useEffect, useState } from "react";
import {
  LookupListsCard,
  type LookupListsCardEntry,
} from "@/components/settings/LookupListsCard";
import { AnthropicSpendBreakdownTable } from "@/components/settings/AnthropicSpendBreakdownTable";
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
// Anthropic Spend card (read-only as of Phase 5.15; per-function breakdown
// table added Phase 5.15.1; Month / Year window toggle added Phase 5.15.3)
// ---------------------------------------------------------------------------

type BreakdownRow = {
  app: "talent_scout" | "venue_scout" | "hq";
  fn_name: string;
  calls: number;
  total_cost_usd: number;
  avg_cost_usd: number;
};

// Name carry-over from Phase 5.15 (no cap input lives here anymore;
// rename to AnthropicSpendCard deferred per Phase 5.15.1 spec § 6).
function SpendCapCard() {
  const [windowKind, setWindowKind] = useState<"month" | "year">("month");
  const [vsSpend, setVsSpend] = useState(0);
  const [globalSpend, setGlobalSpend] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      const { data: rows, error } = await supabase.rpc(
        "anthropic_spend_breakdown",
        { window_kind: windowKind },
      );
      if (!active) return;
      if (error) {
        toast({
          title: "Couldn't load VS spend breakdown",
          description: error.message,
          variant: "destructive",
        });
        setVsSpend(0);
        setGlobalSpend(0);
      } else {
        const all = (rows ?? []) as BreakdownRow[];
        const vsTotal = all
          .filter((r) => r.app === "venue_scout")
          .reduce((acc, r) => acc + Number(r.total_cost_usd ?? 0), 0);
        const globalTotal = all.reduce(
          (acc, r) => acc + Number(r.total_cost_usd ?? 0),
          0,
        );
        setVsSpend(vsTotal);
        setGlobalSpend(globalTotal);
      }
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [windowKind]);

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

  const windowLabel = windowKind === "year" ? "this year" : "this month";

  return (
    <section className="card">
      <div className="card-headbar">
        <h2 className="h-card">Anthropic Spend</h2>
      </div>
      <div className="card-pad space-y-3">
        <p className="text-xs text-muted-foreground">
          Venue Scout's contribution to the selected window's Anthropic spend. Cap
          and full per-tool breakdown live on the HQ Admin Settings page.
        </p>
        <div className="flex flex-wrap items-center gap-6">
          <div>
            <div className="label-form">Venue Scout ({windowLabel})</div>
            <div className="text-[17px] font-bold text-primary">
              ${vsSpend.toFixed(2)}
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
                aria-selected={windowKind === "month"}
                className={windowKind === "month" ? "on" : undefined}
                onClick={() => setWindowKind("month")}
              >
                Month
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={windowKind === "year"}
                className={windowKind === "year" ? "on" : undefined}
                onClick={() => setWindowKind("year")}
              >
                Year
              </button>
            </div>
          </div>
          <AnthropicSpendBreakdownTable appFilter="venue_scout" window={windowKind} />
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// System Prompts placeholder
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
