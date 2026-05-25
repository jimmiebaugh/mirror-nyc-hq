// Phase 4.8.2-port + audit pass 2 item 3: Generating loading screen.
//
// Audit pass 2 swap-out:
//   - Shell rendered through `VSLoadingShell` (icon-as-spinner hammer; the
//     icon itself swings in a strike-and-return motion, no separate
//     spinning circle). Eyebrow + h-page duplication dropped; h-page lives
//     inside the shell.
//   - First-class step list added (per the plan; Generating previously
//     shipped without a step list). Keys match the backend's
//     `brief_data.progress_step` contract from item 3 (copying_template /
//     populating_slides / inserting_photos / finalizing). setInterval timer
//     stays for now and walks the keys at the prior 12-second cadence;
//     item 3b swaps the timer for a derived read of
//     `scout?.brief_data?.progress_step` after the edge function deploys.
//   - Description last sentence updated to "This typically takes 2 minutes."
//     per the plan; the prior 2-5 minute range overstated the median run.
//
// Original 4.8.2-port docblock kept below for context.
// -----------------------------------------------------------------------
// Phase 4.8.2-port: Generating loading screen + Realtime subscription on
// vs_scouts.generated_decks. Closes the 404 window 4.8.1-port opened at
// /venue-scout/scouts/:id/deck/generating.
//
// Adaptations:
//   - Initial scout fetch + 3-second polling fallback (Realtime publication
//     can hiccup).
//   - Kickoff invokes vs-generate-deck fire-and-forget. Function returns
//     200 immediately; AI work runs inside EdgeRuntime.waitUntil. Page
//     learns about completion via Realtime, not the response.
//   - Failure path: vs-generate-deck writes status='failed' + pipeline_error
//     formatted as `<CODE>: <message>`. Page parses the code with a regex,
//     falls back to UNKNOWN, and navigates to /deck/error/<code>.

import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import {
  VSLoadingShell,
  type LoadingShellStep,
} from "@/components/venue-scout/VSLoadingShell";

const STEPS: readonly LoadingShellStep[] = [
  { key: "copying_template", label: "Copying deck template" },
  { key: "populating_slides", label: "Populating venue slides" },
  { key: "inserting_photos", label: "Inserting venue photos" },
  { key: "finalizing", label: "Finalizing deck" },
];

type ScoutRow = {
  id: string;
  current_step: string | null;
  status: string | null;
  pipeline_error: string | null;
  generated_decks: unknown;
  brief_data: Record<string, unknown> | null;
};

const ERROR_CODE_RE = /^([A-Z_]+):/;

function parseErrorCode(researchError: string | null | undefined): string {
  if (!researchError) return "UNKNOWN";
  const m = researchError.match(ERROR_CODE_RE);
  return m ? m[1] : "UNKNOWN";
}

export default function Generating() {
  const { id: scoutId } = useParams();
  const navigate = useNavigate();
  const [scout, setScout] = useState<ScoutRow | null>(null);
  // Guard against Realtime firing the success effect twice in quick
  // succession (Realtime + polling fallback can both deliver the same
  // UPDATE) and trying to window.open / navigate twice. Set once, then
  // the second invocation no-ops.
  const handledTerminalRef = useRef(false);
  // Snapshot the prior deck count on first scout state. The success
  // effect only fires when the count INCREASES past this baseline --
  // otherwise a regenerate where DeckPrep didn't fully reset the scout
  // state would race and re-open the prior deck.
  const initialDeckCountRef = useRef<number | null>(null);

  useEffect(() => {
    if (!scoutId) return;

    let cancelled = false;
    let pollId: ReturnType<typeof setInterval> | null = null;

    const fetchScout = async () => {
      const { data } = await supabase
        .from("vs_scouts")
        .select(
          "id, current_step, status, pipeline_error, generated_decks, brief_data",
        )
        .eq("id", scoutId)
        .maybeSingle();
      if (!cancelled && data) setScout(data as unknown as ScoutRow);
    };

    // 1. Realtime subscription on the scout row. Subscribe first so the
    //    optimistic clear write below produces an event we can react to.
    const channel = supabase
      .channel(`vs_scout_deck_${scoutId}`)
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

    // 2. Optimistic clear of any prior failure state BEFORE the initial
    //    fetch lands. Without this, a Generate-after-failure flow lets
    //    the page read stale `status='failed' + pipeline_error='...'`
    //    from a prior run and the nav effect immediately routes back to
    //    /deck/error/<code> before the new run even starts. The edge
    //    function also clears these at kickoff (idempotent double-write
    //    is fine).
    void (async () => {
      await supabase
        .from("vs_scouts")
        .update({ status: "in_progress", pipeline_error: null })
        .eq("id", scoutId);

      if (cancelled) return;
      await fetchScout();

      if (cancelled) return;
      pollId = setInterval(fetchScout, 3000);

      // Kick off the edge function. Fire-and-forget; the function returns
      // a 200 immediately and runs the Slides work inside
      // EdgeRuntime.waitUntil. Server-side idempotency on
      // brief_data.deck_generation_started_at within 90s grace makes
      // dev-mode double-mount and refresh-mid-flight both safe.
      if (cancelled) return;
      void supabase.functions.invoke("vs-generate-deck", {
        body: { scout_id: scoutId },
      });
    })();

    return () => {
      cancelled = true;
      if (pollId !== null) clearInterval(pollId);
      supabase.removeChannel(channel);
    };
  }, [scoutId]);

  // Navigation effect: react to scout state changes from Realtime / poll.
  useEffect(() => {
    if (!scout || !scoutId) return;
    if (handledTerminalRef.current) return;

    // Snapshot the prior deck count on the first scout state we see.
    if (initialDeckCountRef.current === null) {
      const initialDecks = Array.isArray(scout.generated_decks)
        ? scout.generated_decks
        : [];
      initialDeckCountRef.current = initialDecks.length;
    }

    // Success: vs-generate-deck appended to generated_decks AND flipped
    // current_step to 'completed'.
    //
    // Post-success flow: (1) open the freshly-generated deck's edit_url
    // in a new tab so the producer can review it immediately, and (2)
    // navigate back to the consolidated brief/report surface with the
    // just-generated toast. `replace: true` keeps /generating out of
    // history.
    //
    // Popup-blocker note: window.open after a Realtime event has no
    // immediate user gesture, so some browsers may block the new tab.
    // The deck URL is also visible on /brief and via Scout Settings for
    // manual retrieval if the popup is blocked. `noopener,noreferrer`
    // prevents the opened tab from navigating this window via
    // window.opener.
    const decks = Array.isArray(scout.generated_decks)
      ? scout.generated_decks
      : [];
    const baseline = initialDeckCountRef.current ?? 0;
    if (
      decks.length > baseline &&
      scout.current_step === "completed"
    ) {
      handledTerminalRef.current = true;
      const latest = decks[decks.length - 1];
      if (latest && typeof latest === "object") {
        const editUrl = (latest as { edit_url?: unknown }).edit_url;
        if (typeof editUrl === "string" && editUrl.length > 0) {
          window.open(editUrl, "_blank", "noopener,noreferrer");
        }
      }
      navigate(
        `/venue-scout/scouts/${scoutId}/brief/report?just-generated=true`,
        { replace: true },
      );
      return;
    }

    // Failure: vs-generate-deck writes status='failed' + pipeline_error
    // formatted as `<CODE>: <message>`. Parse the code, fall back to
    // UNKNOWN, route to the per-key error stub. `replace: true` same
    // reasoning as the success path.
    if (scout.status === "failed" && scout.pipeline_error) {
      handledTerminalRef.current = true;
      const code = parseErrorCode(scout.pipeline_error);
      navigate(`/venue-scout/scouts/${scoutId}/deck/error/${code}`, {
        replace: true,
      });
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

  return (
    <VSLoadingShell
      scoutId={scoutId}
      icon="hammer"
      title="Generating Deck"
      description="Copying the deck template into the Drive output folder, populating slides with project + venue data, and inserting your photos. This typically takes 2 minutes."
      steps={STEPS}
      activeStepKey={active}
    />
  );
}
