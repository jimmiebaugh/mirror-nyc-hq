import * as React from "react";

// Matrix primitives. Lifted from VS Pro
// (src/components/sourcing/matrix/primitives.tsx) with HQ design-token swaps
// per Phase 4.6-port spec § 1 substitutions:
//   - VS Pro `bg-[hsl(var(--surface))]`   (sticky-cell bg)   -> HQ `bg-surface-alt`
//   - VS Pro `bg-[hsl(var(--surface-2))]` (row hover, focus) -> HQ `bg-input`
//   - VS Pro `bg-[hsl(var(--bg-elevated))]` (header strip)   -> HQ `bg-surface`
//     (NOT `bg-secondary/30` like the list-view header strips in 4.2 /
//     4.4 — sticky col headers need an OPAQUE background or the
//     horizontal-scroll columns bleed through. HQ `--surface` is 0 0% 4%,
//     matching VS Pro `--bg-elevated` exactly.)
// Type-pill rgba palette + rank-tier hex colors are KEPT verbatim (port plan
// § 4 fidelity rule; HQ doesn't redefine these and the desaturated palette
// is part of the intentional matrix visual language).

import {
  CANONICAL_TYPES,
  type CanonicalType,
  TYPE_STYLES,
  TYPE_FALLBACK_STYLE,
  parseTypes,
  canonicalizeType,
} from "@/lib/venue-scout/venueTypes";

// Re-export so matrix consumers (SourcingReport, Shortlist) can import
// everything from a single module, matching VS Pro's import shape.
export { CANONICAL_TYPES, TYPE_STYLES, TYPE_FALLBACK_STYLE, parseTypes, canonicalizeType };
export type { CanonicalType };

export type RankTier = "green" | "yellow" | "red" | "gray";
export function rankBucket(score: number | null): RankTier {
  if (score == null) return "gray";
  if (score >= 85) return "green";
  if (score >= 70) return "yellow";
  return "red";
}
export const RANK_TEXT: Record<RankTier, string> = {
  green: "text-[#4ade80]",
  yellow: "text-[#f59e0b]",
  red: "text-[#ef4444]",
  gray: "text-[#555]",
};
export const RANK_BAR: Record<RankTier, string> = {
  green: "bg-[#4ade80]",
  yellow: "bg-[#f59e0b]",
  red: "bg-[#ef4444]",
  gray: "bg-[#555]",
};

export function Pill({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center px-[10px] py-[4px] rounded-[3px] text-[10.5px] font-bold uppercase tracking-[0.06em] leading-[1.2] whitespace-nowrap border ${className}`}
    >
      {children}
    </span>
  );
}

export function VStack({
  top,
  bot,
  asAlign = false,
  dividerPad = 0,
  dividerRight = null,
}: {
  top: React.ReactNode;
  bot: React.ReactNode;
  asAlign?: boolean;
  dividerPad?: number;
  dividerRight?: React.ReactNode;
}) {
  const topPad = 6 + dividerPad;
  const botPad = (asAlign ? 12 : 6) + dividerPad;
  return (
    <div className={`h-full flex flex-col ${asAlign ? "" : "justify-center"}`}>
      <div
        style={{ paddingBottom: topPad }}
        className={`flex flex-col items-center text-center relative ${asAlign ? "flex-[8_1_0] justify-center" : "flex-none justify-end"}`}
      >
        {top}
      </div>
      <div className="relative w-1/2 mx-auto h-px bg-[#333]">
        {dividerRight ? (
          <div className="absolute left-full top-1/2 -translate-y-1/2 pl-1 flex items-center">
            {dividerRight}
          </div>
        ) : null}
      </div>
      <div
        style={{ paddingTop: botPad }}
        className={`flex flex-col items-center text-center ${asAlign ? "flex-[2_1_0] justify-center" : "flex-none justify-start"}`}
      >
        {bot}
      </div>
    </div>
  );
}

export function HdrStack({ a, b }: { a: string; b: string }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <span>{a}</span>
      <span className="w-1/2 h-px bg-border" />
      <span>{b}</span>
    </div>
  );
}

export type StickyCol = "col1" | "col2";
const STICKY_TH: Record<StickyCol, string> = {
  col1: "sticky left-0 z-30 shadow-none",
  col2: "sticky left-[60px] z-30 shadow-[4px_0_6px_-2px_rgba(0,0,0,0.4)]",
};
// HQ token swap: VS Pro pins sticky cells against `bg-[hsl(var(--surface))]`.
// HQ's matrix container uses `bg-surface-alt` for the inner subtle surface
// (design-system § 12 rule 1), so sticky cells inherit the same color and the
// pinned columns visually merge with the body.
const STICKY_TD: Record<StickyCol, string> = {
  col1: "sticky left-0 z-10 bg-surface-alt",
  col2: "sticky left-[60px] z-10 bg-surface-alt shadow-[4px_0_6px_-2px_rgba(0,0,0,0.4)]",
};

export function Th({
  children,
  sticky,
}: {
  children: React.ReactNode;
  sticky?: StickyCol;
}) {
  const s = sticky ? STICKY_TH[sticky] : "";
  return (
    <th
      className={`bg-surface text-subtle text-[11px] font-bold uppercase tracking-[0.12em] px-3 py-[14px] border-b border-border border-r border-border text-center align-middle leading-[1.25] matrix-th-text last:border-r-0 ${s}`}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  className = "",
  vCenter = false,
  noPadX = false,
  noPadY = false,
  sticky,
}: {
  children: React.ReactNode;
  className?: string;
  vCenter?: boolean;
  noPadX?: boolean;
  noPadY?: boolean;
  sticky?: StickyCol;
}) {
  const px = noPadX ? "px-[2px]" : "px-3";
  const py = noPadY ? "py-0" : "py-3";
  const va = vCenter ? "align-middle" : "align-top";
  const s = sticky ? STICKY_TD[sticky] : "";
  return (
    <td
      style={{ height: 1 }}
      className={`${px} ${py} ${va} ${s} ${className}`}
    >
      {children}
    </td>
  );
}

export function Bullets({ items }: { items: string[] }) {
  if (!items?.length) return <span className="text-muted-foreground">-</span>;
  return (
    <ul className="bullets">
      {items.map((it, i) => <li key={i}>{it}</li>)}
    </ul>
  );
}

export function RankDisplay({ score }: { score: number | null }) {
  const bucket = rankBucket(score);
  return (
    <div className="text-center w-full">
      <div
        className={`text-[18px] font-extrabold leading-none mb-[6px] tracking-[-0.01em] ${RANK_TEXT[bucket]}`}
      >
        {score ?? "-"}
        <span className="font-normal opacity-50 text-[14px]"> / 100</span>
      </div>
      <div className="h-[4px] w-1/2 mx-auto rounded-full bg-input overflow-hidden">
        <div
          className={`h-full ${RANK_BAR[bucket]}`}
          style={{ width: `${Math.min(score ?? 0, 100)}%` }}
        />
      </div>
    </div>
  );
}

export function NotesCellButton({
  note,
  onClick,
}: {
  note: string | undefined | null;
  onClick: () => void;
}) {
  if (note) {
    return (
      <button onClick={onClick} className="notes-cell">
        <span className="ico">✎</span>{note}
      </button>
    );
  }
  return (
    <button onClick={onClick} className="notes-cell-empty">+ Add Notes</button>
  );
}

export function EditableVenueName({
  id,
  name,
  onChange,
}: {
  id: string;
  name: string;
  onChange: (next: string) => void;
}) {
  const ref = React.useRef<HTMLSpanElement>(null);
  React.useEffect(() => {
    if (ref.current && ref.current.textContent !== name) {
      ref.current.textContent = name;
    }
  }, [id, name]);
  return (
    <div className="max-w-full px-2 text-center">
      <span
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        spellCheck={false}
        onInput={(e) => onChange((e.currentTarget.textContent ?? "").trim())}
        className="bg-transparent border border-transparent rounded px-1 py-[2px] text-[16px] font-bold leading-[1.25] text-foreground hover:bg-input focus:bg-input focus:border-primary focus:outline-none transition-colors break-words [overflow-wrap:anywhere] inline"
      />
    </div>
  );
}

export function WebsiteArrow({ url }: { url: string | null }) {
  if (!url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      title="Open website"
      className="inline-flex items-center gap-[3px] text-[12px] font-semibold uppercase tracking-[0.06em] text-primary hover:text-white transition-colors"
    >
      Website
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M7 17 17 7" /><path d="M8 7h9v9" />
      </svg>
    </a>
  );
}
