// Phase 4.5-port: AI research loading screen + Realtime subscription on
// vs_scouts. Closes the 404 window 4.4-port opened at
// /venue-scout/scouts/:id/sourcing/researching. VS Pro is the layout
// authority (port plan § 3, Adapt: replace sync await with EdgeRuntime.
// waitUntil kickoff + Realtime subscription per port plan § 8.3).
//
// VS Pro source: src/pages/sourcing/Researching.tsx (~77 lines).
//
// Substitutions:
//   project_id              -> scout_id
//   projects table          -> vs_scouts
//   venues table            -> vs_candidate_venues
//   research-venues         -> vs-research-venues
//   /projects/:id           -> /venue-scout/scouts/:id
//   surface-2 (track bar)   -> bg-input
//   bg-[hsl(var(--success))] -> bg-green-400 (HQ has no --success token)
//   "30 to 60 seconds"      -> spelled out (no en dash per voice rule)
//
// Adaptation: sync await replaced with fire-and-forget invoke + Realtime
// subscription + 3-second polling fallback. Pattern mirrors HQ
// FinalReviewLoading.tsx (Phase 3.5). The Realtime subscription is the
// channel through which the page learns about completion or failure.
// vs-research-venues writes vs_scouts.current_step='sourcing_report' on
// success or status='failed'+pipeline_error on failure; this page reacts
// to either.

import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

const STEPS = [
  "Sheet parsed",
  "Brief context loaded",
  "Researching additional venues…",
  "Cross-referencing addresses & specs",
  "Generating recommendations & considerations",
];

type ScoutRow = {
  id: string;
  current_step: string | null;
  status: string | null;
  pipeline_error: string | null;
};

export default function Researching() {
  const { id: scoutId } = useParams();
  const navigate = useNavigate();
  const [scout, setScout] = useState<ScoutRow | null>(null);
  const [sheetCount, setSheetCount] = useState<number | null>(null);
  const [active, setActive] = useState(2);

  useEffect(() => {
    if (!scoutId) return;

    // No `started` ref guard: React 18 Strict Mode's double-mount in dev
    // would leave the second mount with no Realtime channel or polling
    // (the guard short-circuits before subscription setup). Server-side
    // idempotency on the kickoff invoke (vs-research-venues checks
    // brief_data.research_started_at within 90s grace) makes the
    // double-invoke safe in dev and prod.

    let cancelled = false;

    const fetchScout = async () => {
      const { data } = await supabase
        .from("vs_scouts")
        .select("id, current_step, status, pipeline_error")
        .eq("id", scoutId)
        .maybeSingle();
      if (!cancelled && data) setScout(data as unknown as ScoutRow);
    };

    // 1. Initial fetch (scout + sheet count, in parallel).
    void (async () => {
      const [, { count }] = await Promise.all([
        fetchScout(),
        supabase
          .from("vs_candidate_venues")
          .select("id", { count: "exact", head: true })
          .eq("scout_id", scoutId)
          .eq("source", "sheet"),
      ]);
      if (!cancelled) setSheetCount(count ?? 0);
    })();

    // 2. Realtime subscription on the scout row.
    const channel = supabase
      .channel(`vs_scout_${scoutId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "vs_scouts",
          filter: `id=eq.${scoutId}`,
        },
        (payload) => {
          if (!cancelled) setScout(payload.new as unknown as ScoutRow);
        },
      )
      .subscribe();

    // 3. 3-second polling fallback (belt-and-suspenders, same as
    //    FinalReviewLoading). Realtime is generally reliable but the
    //    publication can hiccup; poll keeps us moving.
    const pollId = setInterval(fetchScout, 3000);

    // 4. Step animation: bump active step every 12 seconds, cap at last.
    //    Verbatim from VS Pro (12000ms interval).
    const stepInterval = setInterval(() => {
      setActive((a) => (a < STEPS.length - 1 ? a + 1 : a));
    }, 12000);

    // 5. Kick off the edge function. Fire-and-forget; the function
    //    returns a 200 immediately and runs the AI work inside
    //    EdgeRuntime.waitUntil. The page learns about completion via
    //    Realtime, not the response.
    void supabase.functions.invoke("vs-research-venues", {
      body: { scout_id: scoutId },
    });

    return () => {
      cancelled = true;
      clearInterval(pollId);
      clearInterval(stepInterval);
      supabase.removeChannel(channel);
    };
  }, [scoutId]);

  // Navigation effect: react to scout state changes from Realtime / poll.
  useEffect(() => {
    if (!scout || !scoutId) return;
    if (scout.current_step === "sourcing_report") {
      // Success: fill progress bar, brief pause, navigate.
      setActive(STEPS.length);
      const t = setTimeout(
        () => navigate(`/venue-scout/scouts/${scoutId}/sourcing/report`),
        600,
      );
      return () => clearTimeout(t);
    }
    if (scout.status === "failed" && scout.pipeline_error) {
      navigate(
        `/venue-scout/scouts/${scoutId}/sourcing/error/research-timeout`,
      );
    }
  }, [scout, scoutId, navigate]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh]">
      {/* Custom spinner ring (VS Pro pattern verbatim) */}
      <div className="relative h-12 w-12 mb-8">
        <div className="absolute inset-0 rounded-full border-2 border-border" />
        <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-primary animate-spin" />
      </div>
      <h1 className="h-page text-center">Researching Venues</h1>
      <p className="text-sm text-muted-foreground text-center mt-4 max-w-md">
        Researching venue candidates, comparing against the brief, and
        preparing the matrix. This typically takes 30 to 60 seconds.
      </p>
      {/* Progress bar (track uses bg-input per design-system § 12 rule 1). */}
      <div className="w-full max-w-md mt-8 h-1 bg-input rounded-full overflow-hidden">
        <div
          className="h-full bg-primary transition-all duration-700"
          style={{
            width: `${Math.min(((active + 1) / STEPS.length) * 100, 100)}%`,
          }}
        />
      </div>
      {/* Step list (verbatim from VS Pro, sheet-count enrichment included). */}
      <ul className="mt-10 space-y-3 text-sm">
        {STEPS.map((label, i) => {
          const done = i < active;
          const current = i === active;
          const skipSheet =
            i === 0 && (sheetCount === 0 || sheetCount == null);
          if (skipSheet) return null;
          const labelText =
            i === 0 && sheetCount
              ? `Sheet parsed · ${sheetCount} venues`
              : label;
          return (
            <li key={i} className="flex items-center gap-3">
              <span
                className={`h-2.5 w-2.5 rounded-full ${
                  done
                    ? "bg-green-400"
                    : current
                      ? "bg-primary animate-pulse"
                      : "bg-border"
                }`}
              />
              <span
                className={
                  current
                    ? "font-semibold"
                    : done
                      ? "text-muted-foreground"
                      : "text-muted-foreground/60"
                }
              >
                {labelText}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
