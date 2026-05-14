// Phase 4 Revision - Intake: redirect handler at /venue-scout/scouts/:id/brief.
//
// Renders nothing. Reads the scout's current_step and dispatches:
//   - current_step === 'brief'  -> /brief/event  (intake in progress)
//   - anything else             -> /brief/report (intake already confirmed;
//                                   the report is the canonical Brief surface)
//
// This is the route the Revisit nav's "Brief" chip points at, so the chip
// lands a producer on the right surface regardless of where the scout is in
// its lifecycle.
import { useEffect, useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

type Target =
  | { kind: "loading" }
  | { kind: "go"; to: string }
  | { kind: "missing" };

export default function BriefIndex() {
  const { id: scoutId } = useParams();
  const [target, setTarget] = useState<Target>({ kind: "loading" });

  useEffect(() => {
    if (!scoutId) {
      setTarget({ kind: "missing" });
      return;
    }
    let active = true;
    (async () => {
      const { data, error } = await supabase
        .from("vs_scouts")
        .select("current_step")
        .eq("id", scoutId)
        .maybeSingle();
      if (!active) return;
      if (error || !data) {
        setTarget({ kind: "missing" });
        return;
      }
      const base = `/venue-scout/scouts/${scoutId}/brief`;
      setTarget({
        kind: "go",
        to: data.current_step === "brief" ? `${base}/event` : `${base}/report`,
      });
    })();
    return () => {
      active = false;
    };
  }, [scoutId]);

  if (target.kind === "loading") {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }
  if (target.kind === "missing") {
    return <Navigate to="/venue-scout" replace />;
  }
  return <Navigate to={target.to} replace />;
}
