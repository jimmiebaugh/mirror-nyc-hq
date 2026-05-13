// Phase 4.7.2-port: AI compile loading screen + Realtime subscription on
// vs_scouts. Closes the 404 window 4.7.1-port opened at
// /venue-scout/scouts/:id/sourcing/compiling. VS Pro is the layout
// authority (port plan § 3, Adapt: replace sync await with
// EdgeRuntime.waitUntil kickoff + Realtime subscription per port plan
// § 8.3).
//
// VS Pro source: src/pages/sourcing/Compiling.tsx (~82 lines).
//
// Substitutions:
//   projectId            -> scoutId
//   projects table       -> vs_scouts
//   venues table         -> vs_candidate_venues
//   compile-summaries    -> vs-compile-summaries
//   /projects/:id        -> /venue-scout/scouts/:id
//   surface-2 (track)    -> bg-input
//   bg-[hsl(var(--success))] -> bg-green-400 (HQ has no --success token)
//   "30-60 seconds"      -> spelled out (no en dash per voice rule)
//
// Adaptation: sync await replaced with fire-and-forget invoke + Realtime
// subscription + 3-second polling fallback. Pattern mirrors the 4.5-port
// Researching page. The Realtime subscription is the channel through
// which the page learns about completion or failure. vs-compile-summaries
// writes vs_scouts.current_step='deck_prep' on success or
// status='failed'+pipeline_error on failure; this page reacts to either.
//
// Active step starts at "summaries" because the producer just confirmed
// "selects" on the Review page. The 4-step animation walks through
// summaries -> slides -> handoff over 12-second intervals (capped at
// handoff). Realtime success flips to "handoff" then navigates after
// 800ms to /deck/prep (404 until 4.8-port).

import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

type StepKey = "selects" | "summaries" | "slides" | "handoff";

const STEPS: { key: StepKey; label: string }[] = [
  { key: "selects", label: "Selects confirmed" },
  { key: "summaries", label: "Venue summaries locked" },
  { key: "slides", label: "Preparing slide content & photos…" },
  { key: "handoff", label: "Handing off to deck builder" },
];

type ScoutRow = {
  id: string;
  current_step: string | null;
  status: string | null;
  pipeline_error: string | null;
};

export default function Compiling() {
  const { id: scoutId } = useParams();
  const navigate = useNavigate();
  const [scout, setScout] = useState<ScoutRow | null>(null);
  const [venueCount, setVenueCount] = useState<number | null>(null);
  // Producer just confirmed Selects on Review; start at "summaries".
  const [active, setActive] = useState<StepKey>("summaries");

  useEffect(() => {
    if (!scoutId) return;

    // No `started` ref guard: React 18 Strict Mode's double-mount in dev
    // would leave the second mount with no Realtime channel or polling
    // (the guard short-circuits before subscription setup). Server-side
    // idempotency on the kickoff invoke (vs-compile-summaries checks
    // brief_data.compile_started_at within 90s grace) makes the
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

    // 1. Initial fetch (scout + pitched count, in parallel).
    void (async () => {
      const [, { count }] = await Promise.all([
        fetchScout(),
        supabase
          .from("vs_candidate_venues")
          .select("id", { count: "exact", head: true })
          .eq("scout_id", scoutId)
          .eq("pitched", true),
      ]);
      if (!cancelled) setVenueCount(count ?? 0);
    })();

    // 2. Realtime subscription on the scout row.
    const channel = supabase
      .channel(`vs_scout_compile_${scoutId}`)
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
    //    Researching). Realtime is generally reliable but the
    //    publication can hiccup; poll keeps us moving.
    const pollId = setInterval(fetchScout, 3000);

    // 4. Step animation: bump active step every 12 seconds, cap at
    //    "handoff". Producer never sees "selects" as the active step
    //    (it's pre-done); animation marches summaries -> slides ->
    //    handoff. Realtime success will jump straight to "handoff"
    //    via the navigation effect.
    const order: StepKey[] = ["summaries", "slides", "handoff"];
    const stepInterval = setInterval(() => {
      setActive((a) => {
        const i = order.indexOf(a);
        return i < order.length - 1 ? order[i + 1] : a;
      });
    }, 12000);

    // 5. Kick off the edge function. Fire-and-forget; the function
    //    returns a 200 immediately and runs the AI work inside
    //    EdgeRuntime.waitUntil. The page learns about completion via
    //    Realtime, not the response.
    void supabase.functions.invoke("vs-compile-summaries", {
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
    if (scout.current_step === "deck_prep") {
      // Success: flip to "handoff", brief pause, navigate to /deck/prep
      // (404 until 4.8-port).
      setActive("handoff");
      const t = setTimeout(
        () => navigate(`/venue-scout/scouts/${scoutId}/deck/prep`),
        800,
      );
      return () => clearTimeout(t);
    }
    if (scout.status === "failed" && scout.pipeline_error) {
      navigate(
        `/venue-scout/scouts/${scoutId}/sourcing/error/compile-failed`,
      );
    }
  }, [scout, scoutId, navigate]);

  const order: StepKey[] = ["selects", "summaries", "slides", "handoff"];
  const activeIdx = order.indexOf(active);
  // "selects" is pre-done; progress bar starts at 25% and walks up.
  const progress = ((activeIdx + 1) / order.length) * 100;

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh]">
      {/* Custom spinner ring (VS Pro pattern verbatim) */}
      <div className="relative h-12 w-12 mb-8">
        <div className="absolute inset-0 rounded-full border-2 border-border" />
        <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-primary animate-spin" />
      </div>
      <h1 className="h-page text-center">Compiling Deck Preview</h1>
      <p className="text-sm text-muted-foreground text-center mt-4 max-w-md">
        Assembling your pitched venues, summaries, and photos into the deck.
        This typically takes 30 to 60 seconds.
      </p>
      {/* Progress bar (track uses bg-input per design-system § 12 rule 1). */}
      <div className="w-full max-w-md mt-8 h-1 bg-input rounded-full overflow-hidden">
        <div
          className="h-full bg-primary transition-all duration-700"
          style={{ width: `${progress}%` }}
        />
      </div>
      {/* Step list (verbatim from VS Pro, venue-count enrichment on "selects"). */}
      <ul className="mt-10 space-y-3 text-sm">
        {STEPS.map((s, i) => {
          const done = i < activeIdx;
          const current = s.key === active;
          const labelText =
            s.key === "selects" && venueCount && venueCount > 0
              ? `${s.label} · ${venueCount} venues`
              : s.label;
          return (
            <li key={s.key} className="flex items-center gap-3">
              <span
                className={`inline-flex h-2.5 w-2.5 rounded-full ${
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
