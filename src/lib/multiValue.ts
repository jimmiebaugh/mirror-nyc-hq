// Phase 5.16.1.1 (Edge #15): canonical multi-value cell splitter shared across
// HQ bulk-import + sheet parsing. The locked delimiter set is `/` and `,`
// (the union VS Phase A `sanitizeMultiAgainst` + frontend `parseTypes` already
// accept). The legacy `|` delimiter is ALSO accepted during a transition window
// so producers holding the old CSV templates don't break; a `|` consumption is
// logged so the deprecation timing can be judged later.
//
// MIRROR: `supabase/functions/_shared/multiValue.ts` keeps the split logic
// below byte-equivalent. Change both files together.

const MULTI_VALUE_SPLIT = /[/,|]/;

export function splitMultiValue(cell: unknown): string[] {
  const raw = String(cell ?? "");
  if (raw.includes("|")) {
    // Transition-window telemetry: drop `|` from MULTI_VALUE_SPLIT and remove
    // this branch once legacy-pipe cells stop appearing.
    console.warn(
      "[multiValue] legacy '|' delimiter consumed; CSV templates now use '/' (',' also accepted)",
    );
  }
  return raw
    .split(MULTI_VALUE_SPLIT)
    .map((t) => t.trim())
    .filter(Boolean);
}
