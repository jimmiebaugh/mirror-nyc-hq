// Phase 5.16.1.1 (Edge #15): edge-side mirror of `src/lib/multiValue.ts`.
// Canonical multi-value cell splitter for sheet parsing. The locked delimiter
// set is `/` and `,`; the legacy `|` delimiter is accepted during a transition
// window and its consumption is logged (Supabase function logs) so the
// deprecation timing can be judged later.
//
// MIRROR: keep the split logic below byte-equivalent with the frontend file.
// Change both files together.

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
