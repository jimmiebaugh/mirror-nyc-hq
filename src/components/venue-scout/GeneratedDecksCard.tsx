// Phase 5.12.14.3 Round 3 § C: deck row refresh. Per-deck card chrome
// dropped; rows are now flat horizontal flex layouts with title on the
// left + Open button on the right. Title is `v{N} Deck` (drops
// `deck_name`); meta uses `date-fns/formatDistanceToNow` for a relative
// timestamp ("Generated 2 days ago") + venue count only (slide count
// dropped). Most-recent Open button stays coral; prior decks render a
// muted-grey ghost variant.
//
// Amendment v5 § 5: show 3 most-recent decks by default; expand toggle
// ("Show all (N decks)" / "Show fewer") when decks.length > 3. Sort by
// generated_at descending. Amendment v6 § 2: toggle button centered
// via `block w-full text-center`.
//
// Amendment v3: outer card chrome dropped. The component is now a
// presentational list of deck rows; the parent (BriefReport's one-sheet
// narrow-column sub-section) provides the section wrapper + label
// eyebrow.
//
// Phase 5.12.14 history: extracted from BriefReport.tsx as part of the
// god-file decomposition (closes the BriefReport.tsx slice of
// code-observations Frontend #19). Pure-presentational; the parent owns
// the post-generate success toast (cluster 3 carry-in 2) so this stays
// stateless aside from the v5 local expand toggle.
import { useState } from "react";
import { ExternalLink } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Button } from "@/components/ui/button";

export type DeckEntry = {
  deck_id?: string;
  deck_name?: string;
  version?: number;
  generated_at?: string;
  venue_count?: number;
  slide_count?: number;
  edit_url?: string;
  embed_url?: string;
};

// Relative-time meta string. Returns "" when the timestamp is missing
// or unparseable so the caller's join() drops the empty token.
function formatDeckGeneratedRelative(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `Generated ${formatDistanceToNow(d, { addSuffix: true })}`;
}

// Generated_at descending. Fall back to existing storage-array order (the
// pre-amendment code used `[...decks].reverse()`) when generated_at is
// missing on either side.
function sortDecksNewestFirst(decks: DeckEntry[]): DeckEntry[] {
  return [...decks].sort((a, b) => {
    const aT = a.generated_at ? new Date(a.generated_at).getTime() : NaN;
    const bT = b.generated_at ? new Date(b.generated_at).getTime() : NaN;
    if (Number.isNaN(aT) && Number.isNaN(bT)) return 0;
    if (Number.isNaN(aT)) return 1;
    if (Number.isNaN(bT)) return -1;
    return bT - aT;
  });
}

const DEFAULT_VISIBLE_COUNT = 3;

export function GeneratedDecksCard({ decks }: { decks: DeckEntry[] }) {
  const [expanded, setExpanded] = useState(false);
  const sorted = sortDecksNewestFirst(decks);
  if (sorted.length === 0) return null;
  const visible = expanded ? sorted : sorted.slice(0, DEFAULT_VISIBLE_COUNT);
  const overflow = sorted.length - DEFAULT_VISIBLE_COUNT;

  return (
    <div className="space-y-3">
      <div className="space-y-3">
        {visible.map((deck, i) => {
          const meta = [
            formatDeckGeneratedRelative(deck.generated_at),
            typeof deck.venue_count === "number" &&
              `${deck.venue_count} venues`,
          ]
            .filter(Boolean)
            .join(" · ");
          const isLatest = i === 0;
          return (
            <div
              key={deck.deck_id ?? `${deck.deck_name}-${i}`}
              className="flex items-center justify-between gap-3"
            >
              <div className="min-w-0 flex-1">
                <div className="text-sm font-bold text-foreground">
                  v{deck.version ?? "?"} Deck
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {meta}
                </div>
              </div>
              {deck.edit_url ? (
                <a
                  href={deck.edit_url}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0"
                >
                  <Button
                    variant={isLatest ? "default" : "ghost"}
                    size="sm"
                    className={
                      isLatest
                        ? "gap-1.5"
                        : "gap-1.5 bg-input text-foreground hover:bg-input/80"
                    }
                  >
                    Open
                    <ExternalLink className="h-3.5 w-3.5" />
                  </Button>
                </a>
              ) : isLatest ? (
                // R6 § M.14: keep the coral CTA visual cue on the latest
                // deck even when edit_url hasn't landed yet (race between
                // generate complete + edit_url write). Renders as a
                // disabled "Generating…" placeholder so the producer sees
                // the row hasn't fully resolved.
                <Button
                  variant="default"
                  size="sm"
                  className="gap-1.5 shrink-0"
                  disabled
                >
                  Generating…
                </Button>
              ) : null}
            </div>
          );
        })}
      </div>
      {overflow > 0 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="block w-full text-center font-mono text-[12px] font-bold uppercase tracking-[0.06em] text-primary hover:underline"
        >
          {expanded
            ? "Show fewer"
            : `Show all (${sorted.length} decks)`}
        </button>
      )}
    </div>
  );
}
