// Phase 4.4-port stub. Thin error-route handler that supersedes the 404
// for parse-fail / empty-sheet cases without the full VS Pro ErrorState.tsx
// (lands in 4.9-port per port plan § 9). 30 lines, no behavior beyond
// rendering a key-keyed message + back link.
//
// VS Pro `src/pages/sourcing/ErrorState.tsx` is the full version; when
// 4.9-port ports it, this stub gets replaced at /venue-scout/scouts/:id/
// sourcing/error/:errorKey.

import { Link, useParams } from "react-router-dom";

type StubEntry = { message: string; back: { route: string; label: string } };

const STUB_ENTRIES: Record<string, StubEntry> = {
  "parse-fail": {
    message:
      "We couldn't parse that sheet. Try a different file, or skip the upload and let us research candidates from the brief.",
    back: { route: "sourcing/sheet-prompt", label: "Sourcing" },
  },
  "empty-sheet": {
    message:
      "We didn't find any venues in that sheet. Try a different file, or skip the upload and let us research candidates from the brief.",
    back: { route: "sourcing/sheet-prompt", label: "Sourcing" },
  },
  // Phase 4.5-port: written by vs-research-venues on any AI / insert /
  // timeout failure. The full ErrorState ports in 4.9-port and will
  // surface vs_scouts.research_error for debug visibility; this stub
  // keeps a static message until then.
  "research-timeout": {
    message:
      "We couldn't finish researching venues. The AI request timed out or returned no results. Head back to Sourcing and try again, or contact the team.",
    back: { route: "sourcing/sheet-prompt", label: "Sourcing" },
  },
  // Phase 4.7.2-port: written by vs-compile-summaries on any AI /
  // timeout failure. Same disposition as research-timeout (single
  // AI-pipeline error channel via vs_scouts.research_error per the
  // decision in docs/decisions.md). Back-link goes to Review (where
  // the producer just came from), not sheet-prompt.
  "compile-failed": {
    message:
      "We couldn't finish compiling the deck. The AI request errored or timed out. Head back to Review or contact the team.",
    back: { route: "sourcing/review", label: "Review" },
  },
};

export default function ErrorStateStub() {
  const { id: scoutId, errorKey } = useParams();
  const entry = STUB_ENTRIES[errorKey ?? ""];
  const message =
    entry?.message ??
    "Something went wrong with the sourcing flow. Head back to Sourcing and try again.";
  const back = entry?.back ?? {
    route: "sourcing/sheet-prompt",
    label: "Sourcing",
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6 pt-12 text-center">
      <div className="text-[14px] font-mono uppercase tracking-widest text-primary">
        Sourcing
      </div>
      <h1 className="h-page">Something went wrong</h1>
      <p className="text-sm text-muted-foreground">{message}</p>
      <div className="pt-4">
        <Link
          to={`/venue-scout/scouts/${scoutId}/${back.route}`}
          className="crumb"
        >
          ← Back to {back.label}
        </Link>
      </div>
    </div>
  );
}
