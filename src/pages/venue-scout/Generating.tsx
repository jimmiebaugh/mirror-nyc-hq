// Phase 4.8.2-port: Generating loading screen + Realtime subscription on
// vs_scouts.generated_decks. Closes the 404 window 4.8.1-port opened at
// /venue-scout/scouts/:id/deck/generating. VS Pro is the layout authority
// (port plan § 3, Lift; Realtime + EdgeRuntime.waitUntil pattern adapted
// per port plan § 8.3 to match 4.5 / 4.7.2).
//
// VS Pro source: src/pages/sourcing/Generating.tsx (~36 lines).
//
// Substitutions:
//   projectId            -> scoutId
//   projects table       -> vs_scouts
//   project-${id}-decks  -> vs_scout_deck_${id} channel
//   /projects/:id/brief  -> /venue-scout/scouts/:id/brief
//   "1-2 minutes"        -> spelled out as "1 to 2 minutes" per voice rule
//
// Adaptations (per spec § 6 + § 4a):
//   - Page wrapper swapped from VS Pro min-h-[70vh] px-8 to AppShell parent
//     + inner flex centered min-h-[60vh] (matches 4.5 / 4.7.2 loading pages).
//   - Initial scout fetch + 3-second polling fallback (belt-and-suspenders;
//     same posture as Researching / Compiling).
//   - Kickoff invokes vs-generate-deck fire-and-forget. Function returns 200
//     immediately; AI work runs inside EdgeRuntime.waitUntil. Page learns
//     about completion via Realtime, not the response.
//   - Server-side idempotency on vs-generate-deck means dev-mode double-mount
//     and refresh-mid-flight are both safe (no double Slides API calls).
//   - Failure path: vs-generate-deck writes status='failed' + pipeline_error
//     formatted as `<CODE>: <message>`. Page parses the code with a regex,
//     falls back to UNKNOWN, and navigates to /deck/error/<code>.

import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

type ScoutRow = {
  id: string;
  current_step: string | null;
  status: string | null;
  pipeline_error: string | null;
  generated_decks: unknown;
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

  useEffect(() => {
    if (!scoutId) return;

    let cancelled = false;
    let pollId: ReturnType<typeof setInterval> | null = null;

    const fetchScout = async () => {
      const { data } = await supabase
        .from("vs_scouts")
        .select("id, current_step, status, pipeline_error, generated_decks")
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

      // 3. Initial fetch (now reads the cleared state).
      if (cancelled) return;
      await fetchScout();

      // 4. 3-second polling fallback (Realtime publication can hiccup;
      //    same pattern as Researching / Compiling).
      if (cancelled) return;
      pollId = setInterval(fetchScout, 3000);

      // 5. Kick off the edge function. Fire-and-forget; the function
      //    returns a 200 immediately and runs the Slides work inside
      //    EdgeRuntime.waitUntil. Server-side idempotency
      //    (brief_data.deck_generation_started_at within 90s grace) makes
      //    dev-mode double-mount and refresh-mid-flight both safe.
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

    // Success: vs-generate-deck appended to generated_decks AND flipped
    // current_step to 'completed'. Navigate to brief landing (the
    // completed-scout home; matches VS Pro Generating's /projects/:id/brief
    // target). `replace: true` keeps /generating out of history so
    // browser-back from /brief doesn't re-mount this page.
    const decks = Array.isArray(scout.generated_decks) ? scout.generated_decks : [];
    if (decks.length > 0 && scout.current_step === "completed") {
      navigate(`/venue-scout/scouts/${scoutId}/brief`, { replace: true });
      return;
    }

    // Failure: vs-generate-deck writes status='failed' + pipeline_error
    // formatted as `<CODE>: <message>`. Parse the code, fall back to
    // UNKNOWN, route to the per-key error stub. `replace: true` same
    // reasoning as the success path.
    if (scout.status === "failed" && scout.pipeline_error) {
      const code = parseErrorCode(scout.pipeline_error);
      navigate(`/venue-scout/scouts/${scoutId}/deck/error/${code}`, {
        replace: true,
      });
    }
  }, [scout, scoutId, navigate]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
      {/* VS Pro spinner verbatim (single ring, no border-border underlay). */}
      <div className="h-10 w-10 rounded-full border-2 border-primary border-t-transparent animate-spin mb-8" />
      <h1 className="h-page">Generating Venue Deck</h1>
      <p className="text-sm text-muted-foreground mt-3 max-w-xl">
        Copying the Mirror template into your Drive folder, populating slides
        with project + venue data, and inserting your photos. This typically
        takes 1 to 2 minutes.
      </p>
    </div>
  );
}
