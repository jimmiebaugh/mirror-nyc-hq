import { getScoreColor } from "@/lib/talent-scout/scoreColor";

/**
 * Inline score readout: colored number + horizontal mini-bar to the right.
 * Used in CandidateTable + FinalReviewDetail's candidate cells under the
 * "SCORE:" label. Replaces the older stacked ScoreBar (which lived in its
 * own column with the bar UNDER the number) — Phase 3.6.5 moved score
 * inside the candidate cell and asked for the bar inline.
 */
export function ScoreInline({
  value,
  max = 100,
  size = 14,
  barWidth = 60,
}: {
  value: number | null | undefined;
  max?: number;
  size?: number;
  /** Width of the inline bar in pixels. */
  barWidth?: number;
}) {
  const v = value ?? 0;
  const pct = Math.min(100, Math.max(0, (v / max) * 100));
  const color = getScoreColor(v);
  return (
    <span className="inline-flex items-center gap-2 align-middle">
      <span
        style={{ color, fontSize: size, lineHeight: 1 }}
        className="font-bold tabular-nums"
      >
        {value == null ? "—" : value}
      </span>
      {value != null && (
        <span
          className="inline-block h-1 overflow-hidden rounded-full bg-secondary"
          style={{ width: barWidth }}
        >
          <span
            className="block h-full rounded-full"
            style={{ width: `${pct}%`, background: color }}
          />
        </span>
      )}
    </span>
  );
}
