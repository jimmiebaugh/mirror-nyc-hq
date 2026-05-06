import { getScoreColor } from "@/lib/talent-scout/scoreColor";

export function ScoreBar({ value, max = 100 }: { value: number | null | undefined; max?: number }) {
  const raw = value ?? 0;
  const v = Math.max(0, raw);
  const pct = Math.min(100, (v / max) * 100);
  const color = getScoreColor(v);
  return (
    <div className="flex min-w-[96px] flex-col gap-1.5">
      <div
        className="text-center text-xl font-black tabular-nums leading-none"
        style={{ color }}
      >
        {v}
        <span className="text-xs font-bold opacity-70">/{max}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
        <div className="h-full rounded-full transition-[width]" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}
