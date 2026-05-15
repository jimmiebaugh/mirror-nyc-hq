import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Phase 5.1 Admin Home pipeline counts row (spec § 7b).
 *
 * Four stat tiles aggregating `projects.status` counts. Sub-captions are
 * intentionally textual; no dollar amounts (Q6 of the locked-decisions
 * memo: HQ does not invoice; no invoice / billing-dollar columns ever).
 *
 * Status string match is intentionally loose; the shipped enum carries
 * labels like "Quote Sent" + "Awaiting Feedback" while Phase 5.2 will
 * canonicalize them. The query counts each label below until 5.2 lands.
 */

type Tile = {
  label: string;
  status: string;
  caption: string;
  numClass: string;
};

const TILES: Tile[] = [
  { label: "Quoting", status: "Quoting", caption: "Quote in progress", numClass: "text-[hsl(var(--warn))]" },
  { label: "Quotes Sent", status: "Quote Sent", caption: "Awaiting client feedback", numClass: "text-[hsl(var(--warn))]" },
  { label: "Billing", status: "Billing", caption: "Awaiting billing", numClass: "text-[hsl(var(--warn))]" },
  { label: "In Progress", status: "In Progress", caption: "Active production", numClass: "text-[#06B6D4]" },
];

export function PipelineCountsRow() {
  const [counts, setCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    let active = true;
    Promise.all(
      TILES.map(async (t) => {
        const { count } = await supabase
          .from("projects")
          .select("id", { count: "exact", head: true })
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .eq("status", t.status as any)
          .is("archived_at", null);
        return [t.status, count ?? 0] as const;
      }),
    ).then((rows) => {
      if (!active) return;
      setCounts(Object.fromEntries(rows));
    });
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="grid grid-cols-4 gap-4">
      {TILES.map((t) => (
        <div key={t.label} className="hq-stat">
          <div className="hq-stat-lbl">{t.label}</div>
          <div className={`hq-stat-num ${t.numClass}`}>{counts[t.status] ?? 0}</div>
          <div className="hq-stat-sub">{t.caption}</div>
        </div>
      ))}
    </div>
  );
}