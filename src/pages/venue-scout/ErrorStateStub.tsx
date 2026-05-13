// Phase 4.4-port stub. Thin error-route handler that supersedes the 404
// for parse-fail / empty-sheet cases without the full VS Pro ErrorState.tsx
// (lands in 4.9-port per port plan § 9). Routes under
// /venue-scout/scouts/:id/sourcing/error/:errorKey and (from 4.8.2-port)
// /venue-scout/scouts/:id/deck/error/:errorKey.
//
// VS Pro `src/pages/sourcing/ErrorState.tsx` is the full version; when
// 4.9-port ports it, this stub gets replaced.
//
// Phase 4.8.2-port: deck-generation error keys added. Per-key back routes
// were always per-key; this sub-phase formalizes the route as a function
// of scoutId so the deck keys can point back to /deck/prep instead of
// the sourcing breadcrumb. The eyebrow label switches from a static
// "Sourcing" to a per-entry value so deck errors don't lie about which
// stage failed.

import { Link, useParams } from "react-router-dom";

type StubEntry = {
  message: string;
  back: (scoutId: string) => { route: string; label: string };
  eyebrow: string;
};

const STUB_ENTRIES: Record<string, StubEntry> = {
  "parse-fail": {
    message:
      "We couldn't parse that sheet. Try a different file, or skip the upload and let us research candidates from the brief.",
    back: (id) => ({
      route: `/venue-scout/scouts/${id}/sourcing/sheet-prompt`,
      label: "Sourcing",
    }),
    eyebrow: "Sourcing",
  },
  "empty-sheet": {
    message:
      "We didn't find any venues in that sheet. Try a different file, or skip the upload and let us research candidates from the brief.",
    back: (id) => ({
      route: `/venue-scout/scouts/${id}/sourcing/sheet-prompt`,
      label: "Sourcing",
    }),
    eyebrow: "Sourcing",
  },
  // Phase 4.5-port: written by vs-research-venues on any AI / insert /
  // timeout failure. The full ErrorState ports in 4.9-port and will
  // surface vs_scouts.research_error for debug visibility; this stub
  // keeps a static message until then.
  "research-timeout": {
    message:
      "We couldn't finish researching venues. The AI request timed out or returned no results. Head back to Sourcing and try again, or contact the team.",
    back: (id) => ({
      route: `/venue-scout/scouts/${id}/sourcing/sheet-prompt`,
      label: "Sourcing",
    }),
    eyebrow: "Sourcing",
  },
  // Phase 4.7.2-port: written by vs-compile-summaries on any AI /
  // timeout failure. Same disposition as research-timeout (single
  // AI-pipeline error channel via vs_scouts.research_error per the
  // decision in docs/decisions.md). Back-link goes to Review (where
  // the producer just came from), not sheet-prompt.
  "compile-failed": {
    message:
      "We couldn't finish compiling the deck. The AI request errored or timed out. Head back to Review or contact the team.",
    back: (id) => ({
      route: `/venue-scout/scouts/${id}/sourcing/review`,
      label: "Review",
    }),
    eyebrow: "Sourcing",
  },
  // Phase 4.8.2-port: written by vs-generate-deck on any service-account
  // / Drive / Slides failure. research_error is formatted as
  // `<CODE>: <message>`; the Generating page parses the code and routes
  // to /deck/error/<code>. All five codes back-route to /deck/prep so
  // the producer can re-trigger Generate after fixing whatever blocked
  // the run.
  AUTH_FAILED: {
    message:
      "We couldn't authenticate with Google Drive. The service account credentials may need to be refreshed. Contact the team.",
    back: (id) => ({
      route: `/venue-scout/scouts/${id}/deck/prep`,
      label: "Deck Prep",
    }),
    eyebrow: "Deck",
  },
  TEMPLATE_COPY_FAILED: {
    message:
      "We couldn't copy the deck template into Drive. The template file or output folder may be inaccessible. Contact the team.",
    back: (id) => ({
      route: `/venue-scout/scouts/${id}/deck/prep`,
      label: "Deck Prep",
    }),
    eyebrow: "Deck",
  },
  SLIDES_API_FAILED: {
    message:
      "Google Slides returned an error while populating the deck. The deck was partially created; check your Drive folder. Try generating again or contact the team.",
    back: (id) => ({
      route: `/venue-scout/scouts/${id}/deck/prep`,
      label: "Deck Prep",
    }),
    eyebrow: "Deck",
  },
  NO_VENUES_INCLUDED: {
    message:
      "No venues are marked for the deck. Go back to Deck Prep and check at least one venue's Include checkbox.",
    back: (id) => ({
      route: `/venue-scout/scouts/${id}/deck/prep`,
      label: "Deck Prep",
    }),
    eyebrow: "Deck",
  },
  UNKNOWN: {
    message:
      "Something unexpected went wrong while generating the deck. Try again or contact the team.",
    back: (id) => ({
      route: `/venue-scout/scouts/${id}/deck/prep`,
      label: "Deck Prep",
    }),
    eyebrow: "Deck",
  },
};

export default function ErrorStateStub() {
  const { id: scoutId, errorKey } = useParams();
  const safeId = scoutId ?? "";
  const entry = STUB_ENTRIES[errorKey ?? ""];
  const message =
    entry?.message ??
    "Something went wrong with the sourcing flow. Head back to Sourcing and try again.";
  const back = entry
    ? entry.back(safeId)
    : {
        route: `/venue-scout/scouts/${safeId}/sourcing/sheet-prompt`,
        label: "Sourcing",
      };
  const eyebrow = entry?.eyebrow ?? "Sourcing";

  return (
    <div className="mx-auto max-w-3xl space-y-6 pt-12 text-center">
      <div className="text-[14px] font-mono uppercase tracking-widest text-primary">
        {eyebrow}
      </div>
      <h1 className="h-page">Something went wrong</h1>
      <p className="text-sm text-muted-foreground">{message}</p>
      <div className="pt-4">
        <Link to={back.route} className="crumb">
          ← Back to {back.label}
        </Link>
      </div>
    </div>
  );
}
