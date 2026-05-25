// Phase 4.7.2-port + audit pass 2 item 3: AI compile loading screen.
//
// Audit pass 2 swap-out:
//   - Shell rendered through `VSLoadingShell` (icon-as-spinner pencil; the
//     icon itself animates, no separate spinning circle). Eyebrow + h-page
//     duplication dropped; h-page lives inside the shell.
//   - Step keys renamed to match the backend's `brief_data.progress_step`
//     contract from item 3 (loading_pitched / pass_1_fill / pass_2_overview
//     / handoff). The setInterval timer stays for now and walks the keys at
//     the prior 12-second cadence; item 3b swaps the timer for a derived
//     read of `scout?.brief_data?.progress_step` after the edge function
//     deploys. Fallback to STEPS[0].key when the field is absent so older
//     scouts in flight don't render a broken step list.
//
// Original 4.7.2 docblock kept below for context.
// -----------------------------------------------------------------------
// Phase 4.7.2-port: AI compile loading screen + Realtime subscription on
// vs_scouts. Closes the 404 window 4.7.1-port opened at
// /venue-scout/scouts/:id/sourcing/compiling.
//
// Adaptation: sync await replaced with fire-and-forget invoke + Realtime
// subscription + 3-second polling fallback. The Realtime subscription is
// the channel through which the page learns about completion or failure.
// vs-compile-summaries writes vs_scouts.current_step='deck_prep' on success
// or status='failed'+pipeline_error on failure; this page reacts to either.

import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import {
  VSLoadingShell,
  type LoadingShellStep,
} from "@/components/venue-scout/VSLoadingShell";

const STEPS: readonly LoadingShellStep[] = [
  { key: "loading_pitched", label: "Selects confirmed" },
  { key: "pass_1_fill", label: "Venue summaries locked" },
  { key: "pass_2_overview", label: "Preparing slide content & photos" },
  { key: "handoff", label: "Handing off to deck builder" },
];

type ScoutRow = {
  id: string;
  current_step: string | null;
  status: string | null;
  pipeline_error: string | null;
  brief_data: Record<string, unknown> | null;
};

export default function Compiling() {
  const { id: scoutId } = useParams();
  const navigate = useNavigate();
  const [scout, setScout] = useState<ScoutRow | null>(null);
  const [venueCount, setVenueCount] = useState<number | null>(null);

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
        .select("id, current_step, status, pipeline_error, brief_data")
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

    // 3. 3-second polling fallback (belt-and-suspenders).
    const pollId = setInterval(fetchScout, 3000);

    // 4. Kick off the edge function. Fire-and-forget; the function returns
    //    a 200 immediately and runs the AI work inside EdgeRuntime.waitUntil.
    void supabase.functions.invoke("vs-compile-summaries", {
      body: { scout_id: scoutId },
    });

    return () => {
      cancelled = true;
      clearInterval(pollId);
      supabase.removeChannel(channel);
    };
  }, [scoutId]);

  // Navigation effect: react to scout state changes from Realtime / poll.
  useEffect(() => {
    if (!scout || !scoutId) return;
    if (scout.current_step === "deck_prep") {
      // Success: brief pause, navigate to the consolidated Review surface
      // (Phase 5.12.15; was /deck/prep).
      const t = setTimeout(
        () => navigate(`/venue-scout/scouts/${scoutId}/review`),
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

  if (!scoutId) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  // Audit pass 2 item 3b: derive active step from server-emitted
  // brief_data.progress_step (Realtime channel triggers re-render on
  // UPDATE). Fallback to STEPS[0].key when the field is absent (scout
  // created mid-pipeline at deploy time, or older scouts).
  const progressStep =
    typeof scout?.brief_data?.progress_step === "string"
      ? (scout.brief_data.progress_step as string)
      : null;
  const active = progressStep ?? STEPS[0].key;

  const description =
    venueCount && venueCount > 0
      ? `Assembling your ${venueCount} pitched ${
          venueCount === 1 ? "venue" : "venues"
        }, summaries, and photos into a deck preview. This typically takes about 60 seconds.`
      : "Assembling your pitched venues, summaries, and photos into a deck preview. This typically takes about 60 seconds.";

  return (
    <VSLoadingShell
      scoutId={scoutId}
      icon="pencil"
      title="Compiling"
      description={description}
      steps={STEPS}
      activeStepKey={active}
    />
  );
}
