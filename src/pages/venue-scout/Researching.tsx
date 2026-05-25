// Phase 4.5-port + audit pass 2 item 3: AI research loading screen.
//
// Audit pass 2 swap-out:
//   - Shell rendered through `VSLoadingShell` (icon-as-spinner magnifying
//     glass; the icon itself sweeps in a slow scan motion, no separate
//     spinning circle). Eyebrow + h-page duplication dropped; h-page lives
//     inside the shell. Horizontal progress bar removed (step list is the
//     producer's progress signal now).
//   - Step keys renamed to match the backend's `brief_data.progress_step`
//     contract from item 3 (brief_loaded / phase_a_enrichment /
//     phase_b_research / finalizing). setInterval timer stays for now and
//     walks the keys at the prior 12-second cadence; item 3b swaps the
//     timer for a derived read of `scout?.brief_data?.progress_step` after
//     the edge function deploys. Fallback to STEPS[0].key when the field
//     is absent so older scouts in flight don't render a broken step list.
//   - Sheet-count enrichment pulled from the step list. The 4-step list no
//     longer has a "Sheet parsed" pre-step (it never tracked a real phase;
//     it was a confirmation that sheet upload finished before this page
//     mounted). If a future producer needs that signal back, surface it in
//     the page description instead.
//
// Original 4.5-port docblock kept below for context.
// -----------------------------------------------------------------------
// Phase 4.5-port: AI research loading screen + Realtime subscription on
// vs_scouts. Closes the 404 window 4.4-port opened at
// /venue-scout/scouts/:id/sourcing/researching.
//
// Adaptation: sync await replaced with fire-and-forget invoke + Realtime
// subscription + 3-second polling fallback. The Realtime subscription is
// the channel through which the page learns about completion or failure.
// vs-research-venues writes vs_scouts.current_step='sourcing_report' on
// success or status='failed'+pipeline_error on failure; this page reacts
// to either.

import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import {
  VSLoadingShell,
  type LoadingShellStep,
} from "@/components/venue-scout/VSLoadingShell";

const STEPS: readonly LoadingShellStep[] = [
  { key: "brief_loaded", label: "Brief context loaded" },
  { key: "phase_a_enrichment", label: "Enriching sheet venues" },
  { key: "phase_b_research", label: "Researching additional venues" },
  { key: "finalizing", label: "Generating recommendations & considerations" },
];

type ScoutRow = {
  id: string;
  current_step: string | null;
  status: string | null;
  pipeline_error: string | null;
  brief_data: Record<string, unknown> | null;
};

export default function Researching() {
  const { id: scoutId } = useParams();
  const navigate = useNavigate();
  const [scout, setScout] = useState<ScoutRow | null>(null);

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
        .select("id, current_step, status, pipeline_error, brief_data")
        .eq("id", scoutId)
        .maybeSingle();
      if (!cancelled && data) setScout(data as unknown as ScoutRow);
    };

    void fetchScout();

    // Realtime subscription on the scout row.
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

    // 3-second polling fallback (Realtime publication can hiccup).
    const pollId = setInterval(fetchScout, 3000);

    // Kick off the edge function. Fire-and-forget; the function returns a
    // 200 immediately and runs the AI work inside EdgeRuntime.waitUntil.
    void supabase.functions.invoke("vs-research-venues", {
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
    if (scout.current_step === "sourcing_report") {
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

  if (!scoutId) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  // Audit pass 2 item 3b: derive active step from server-emitted
  // brief_data.progress_step (Realtime channel triggers re-render on
  // UPDATE). Fallback to STEPS[0].key when the field is absent (scout
  // created mid-pipeline at deploy time, or older scouts) so older
  // pipelines don't render a broken step list.
  const progressStep =
    typeof scout?.brief_data?.progress_step === "string"
      ? (scout.brief_data.progress_step as string)
      : null;
  const active = progressStep ?? STEPS[0].key;

  return (
    <VSLoadingShell
      scoutId={scoutId}
      icon="magnifying-glass"
      title="Researching"
      description="Researching venue candidates, comparing against the brief, and preparing the matrix. This could take up to 4 minutes."
      steps={STEPS}
      activeStepKey={active}
    />
  );
}
