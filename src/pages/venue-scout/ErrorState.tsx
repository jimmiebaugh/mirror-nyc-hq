// Phase 4.9-port: full ErrorState surface. Lifted from VS Pro
// (src/pages/sourcing/ErrorState.tsx) with three substitutions:
//   - Storage bucket sourcing-sheets -> sourcing_sheets (HQ convention).
//   - URL param projectId -> id (scoutId).
//   - CONFIGS extended from VS Pro's 3 keys (empty-sheet, parse-fail,
//     research-timeout) to HQ's 9 keys: VS Pro 3 + compile-failed
//     (4.7.2-port) + 5 deck codes (4.8.2-port: AUTH_FAILED,
//     TEMPLATE_COPY_FAILED, SLIDES_API_FAILED, NO_VENUES_INCLUDED,
//     UNKNOWN).
//
// HQ additions:
//   - vs_scouts.pipeline_error surfaced in a <details> "Debug detail"
//     section below the help card when set. Producer can copy the
//     <CODE>: <message> for triage. Collapsed by default per spec § 14.
//   - Per-page chrome: <ScoutSettingsLink /> (right slot) and
//     <ScoutPhaseBreadcrumb /> (rendered above the help card via the
//     standard scout chrome). On an error route the breadcrumb still
//     reads naturally.
//   - AppShell-respecting wrapper: outer max-w-3xl with the header /
//     gear in flex, inner centered min-h-[60vh] for the actual error
//     panel.
//
// Hyphen-only voice per HQ rules: VS Pro uses em dashes in help bullets;
// those are rewritten as hyphens here.

import { useEffect, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { ScoutSettingsLink } from "@/components/venue-scout/ScoutChrome";

type IconKind = "warn" | "x" | "block";

type Phase = "sourcing" | "review";

type PrimaryAction =
  | "research"
  | "retry-research"
  | "retry-compile"
  | "back-to-deck-prep"
  | "none";

type Cfg = {
  icon: IconKind;
  phase: Phase;
  title: string;
  description: (ctx: { fileName?: string }) => React.ReactNode;
  helpTitle: string;
  help: React.ReactNode;
  primaryLabel?: string;
  primaryAction: PrimaryAction;
  // Secondary action is optional. Round-20: dropped on the four deck
  // error configs where it had been wired to a misleading "Contact
  // the team" button that just routed back to /deck/prep (no actual
  // contact path). Help-text bullets keep the informational guidance
  // about contacting the team where relevant.
  secondaryLabel?: string;
  secondaryHref?: (scoutId: string) => string;
};

const CONFIGS: Record<string, Cfg> = {
  // ----------- Sourcing-side keys (ported from VS Pro) -----------
  "empty-sheet": {
    icon: "warn",
    phase: "sourcing",
    title: "Sheet Looked Empty",
    description: ({ fileName }) => (
      <>
        We parsed {fileName ? <strong>{fileName}</strong> : "your file"} but couldn't pull any venue rows out of it. Either the sheet is empty or the format isn't matching what we expect.
      </>
    ),
    helpTitle: "What we expect:",
    help: (
      <ul className="space-y-1.5 text-sm text-muted-foreground list-disc pl-5">
        <li>One venue per row</li>
        <li>
          Header row with at least <strong className="text-foreground">Name, Neighborhood, Address</strong>
        </li>
        <li>Other columns optional (Sq ft, Type, Features, etc.)</li>
      </ul>
    ),
    primaryLabel: "Skip · Research venues →",
    primaryAction: "research",
    secondaryLabel: "↑ Upload a different file",
    // Phase 5.12.14.1 Stage 2C: /sourcing/sheet-upload merged into /sourcing/sheet-prompt;
    // `?upload=1` auto-expands the upload card on landing so the recovery
    // affordance still lands the producer directly in the drop-zone.
    secondaryHref: (id) => `/venue-scout/scouts/${id}/sourcing/sheet-prompt?upload=1`,
  },
  "parse-fail": {
    icon: "x",
    phase: "sourcing",
    title: "Couldn't Parse the Sheet",
    description: () =>
      "The file you uploaded isn't in a format we can read. We need a clean PDF, XLSX, or CSV with venue rows.",
    helpTitle: "Try one of these:",
    help: (
      <ul className="space-y-1.5 text-sm text-muted-foreground list-disc pl-5">
        <li>
          Re-export from Google Sheets / Excel as <strong className="text-foreground">.xlsx</strong> or <strong className="text-foreground">.csv</strong>
        </li>
        <li>If it's a scanned PDF, try OCR'ing it first or convert to spreadsheet</li>
        <li>Make sure the file is under 25MB</li>
      </ul>
    ),
    primaryLabel: "Skip · Research venues →",
    primaryAction: "research",
    secondaryLabel: "↑ Upload a different file",
    // Phase 5.12.14.1 Stage 2C: /sourcing/sheet-upload merged into /sourcing/sheet-prompt;
    // `?upload=1` auto-expands the upload card on landing so the recovery
    // affordance still lands the producer directly in the drop-zone.
    secondaryHref: (id) => `/venue-scout/scouts/${id}/sourcing/sheet-prompt?upload=1`,
  },
  "research-timeout": {
    icon: "block",
    phase: "sourcing",
    title: "Research Timed Out",
    description: () =>
      "We couldn't finish researching venues in time. This usually clears up in a minute or two, or there may be a service issue on our end.",
    helpTitle: "What you can do:",
    help: (
      <ul className="space-y-1.5 text-sm text-muted-foreground list-disc pl-5">
        <li>
          <strong className="text-foreground">Retry</strong>, we'll re-run the research with the same brief
        </li>
        <li>Wait a minute and try again if research is rate-limited</li>
        <li>Skip research and proceed to the matrix using only your uploaded sheet (if any)</li>
      </ul>
    ),
    primaryLabel: "↻ Retry research",
    primaryAction: "retry-research",
    secondaryLabel: "← Start over",
    secondaryHref: (id) => `/venue-scout/scouts/${id}/sourcing/sheet-prompt`,
  },
  // ----------- Compile-side key (Phase 4.7.2-port) -----------
  "compile-failed": {
    icon: "x",
    phase: "review",
    title: "Compile Failed",
    description: () =>
      "We couldn't finish compiling the deck. The AI request errored or timed out.",
    helpTitle: "What you can do:",
    help: (
      <ul className="space-y-1.5 text-sm text-muted-foreground list-disc pl-5">
        <li>
          <strong className="text-foreground">Retry</strong>, we'll re-run the compile pass with the same selections
        </li>
        <li>Edit selections back on Review if something looks wrong</li>
        <li>Contact the team with the debug detail below if it keeps failing</li>
      </ul>
    ),
    primaryLabel: "↻ Retry compile",
    primaryAction: "retry-compile",
    secondaryLabel: "← Back to Review",
    secondaryHref: (id) => `/venue-scout/scouts/${id}/review`,
  },
  // ----------- Deck-generation keys (Phase 4.8.2-port) -----------
  AUTH_FAILED: {
    icon: "block",
    phase: "review",
    title: "Couldn't Authenticate",
    description: () =>
      "We couldn't authenticate with Google Drive. The service account credentials may need to be refreshed.",
    helpTitle: "What you can do:",
    help: (
      <ul className="space-y-1.5 text-sm text-muted-foreground list-disc pl-5">
        <li>Contact the team to refresh service-account credentials</li>
        <li>Try again in a few minutes if this was transient</li>
      </ul>
    ),
    // No primary action: producer can't self-resolve this.
    primaryAction: "none",
    secondaryLabel: "← Back to Review",
    secondaryHref: (id) => `/venue-scout/scouts/${id}/review`,
  },
  TEMPLATE_COPY_FAILED: {
    icon: "x",
    phase: "review",
    title: "Couldn't Copy the Template",
    description: () =>
      "We couldn't copy the deck template into Drive. The template file or output folder may be inaccessible.",
    helpTitle: "What you can do:",
    help: (
      <ul className="space-y-1.5 text-sm text-muted-foreground list-disc pl-5">
        <li>Try generating again, this is sometimes transient</li>
        <li>Contact the team if it keeps failing; the template file may need to be re-shared with the service account</li>
      </ul>
    ),
    primaryLabel: "← Back to Deck Prep",
    primaryAction: "back-to-deck-prep",
  },
  SLIDES_API_FAILED: {
    icon: "x",
    phase: "review",
    title: "Slides API Errored",
    description: () =>
      "Google Slides returned an error while populating the deck. The deck was partially created; check your Drive folder.",
    helpTitle: "What you can do:",
    help: (
      <ul className="space-y-1.5 text-sm text-muted-foreground list-disc pl-5">
        <li>Try generating again, partial decks are safe to discard</li>
        <li>Contact the team with the debug detail below if it keeps failing</li>
      </ul>
    ),
    primaryLabel: "← Back to Deck Prep",
    primaryAction: "back-to-deck-prep",
  },
  NO_VENUES_INCLUDED: {
    icon: "warn",
    phase: "review",
    title: "No Venues Included",
    description: () =>
      "No venues are marked for the deck. Go back to Deck Prep and check at least one venue's Include checkbox.",
    helpTitle: "What you can do:",
    help: (
      <ul className="space-y-1.5 text-sm text-muted-foreground list-disc pl-5">
        <li>Open Deck Prep and toggle Include on the venues you want in the pitch</li>
        <li>Drag the included venues to set their slide order</li>
      </ul>
    ),
    primaryLabel: "← Back to Deck Prep",
    primaryAction: "back-to-deck-prep",
  },
  // Phase 5.12.0: HQ Venues push at the top of vs-generate-deck failed
  // (the name / address / website dedupe ladder or the venues INSERT or the
  // linked_venue_id UPDATE errored). The deck was not generated; the
  // producer can review the candidate that failed and retry from Deck Prep.
  HQ_PUSH_FAILED: {
    icon: "x",
    phase: "review",
    title: "Could Not Save to HQ Venues",
    description: () =>
      "We couldn't add the deck's venues to HQ Venues, so the deck wasn't generated. This usually means a write to the HQ venues table failed mid-batch.",
    helpTitle: "What you can do:",
    help: (
      <ul className="space-y-1.5 text-sm text-muted-foreground list-disc pl-5">
        <li>Try generating again, this is sometimes transient</li>
        <li>The debug detail below names the candidate that failed; open it in Deck Prep, double-check name + address + website, then retry</li>
        <li>Contact the team with the debug detail if it keeps failing</li>
      </ul>
    ),
    primaryLabel: "← Back to Deck Prep",
    primaryAction: "back-to-deck-prep",
  },
  UNKNOWN: {
    icon: "block",
    phase: "review",
    title: "Something Went Wrong",
    description: () =>
      "Something unexpected went wrong while generating the deck. Try again, or contact the team if it keeps failing.",
    helpTitle: "What you can do:",
    help: (
      <ul className="space-y-1.5 text-sm text-muted-foreground list-disc pl-5">
        <li>Try generating again</li>
        <li>Contact the team with the debug detail below if it persists</li>
      </ul>
    ),
    primaryLabel: "← Back to Deck Prep",
    primaryAction: "back-to-deck-prep",
  },
};

// R6 § L.1: VS Pro back-compat alias retired (no live links exercise it).
// Unrecognized codes now redirect to UNKNOWN via the route-fallback below.
const ALIASES: Record<string, string> = {};

type VsScoutMeta = {
  current_step: string | null;
  pipeline_error: string | null;
};

export default function ErrorState() {
  const { id = "", errorKey = "" } = useParams<{
    id: string;
    errorKey: string;
  }>();
  const nav = useNavigate();

  // ----------- All hooks above any early return -----------
  const [fileName, setFileName] = useState<string | undefined>(undefined);
  const [scout, setScout] = useState<VsScoutMeta | null>(null);
  // Re-entry guard for the primary action button. The action writes
  // current_step + navigates; without the guard a double-click on a slow
  // network fires two updates.
  const [retrying, setRetrying] = useState(false);

  const key = ALIASES[errorKey] ?? errorKey;
  const cfg = CONFIGS[key];

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    // Parallel: fetch the scout (for pipeline_error + step-through meta)
    // and, for sheet-side keys only, the most recent uploaded filename.
    const tasks: Promise<unknown>[] = [
      supabase
        .from("vs_scouts")
        .select("current_step, pipeline_error")
        .eq("id", id)
        .maybeSingle()
        .then(({ data }) => {
          if (cancelled) return;
          setScout((data as VsScoutMeta | null) ?? null);
        }),
    ];
    if (key === "empty-sheet" || key === "parse-fail") {
      tasks.push(
        supabase.storage
          .from("sourcing_sheets")
          .list(id, {
            limit: 1,
            sortBy: { column: "created_at", order: "desc" },
          })
          .then(({ data }) => {
            if (cancelled) return;
            const f = data?.[0]?.name;
            // Strip the `{timestamp}-` prefix that SheetUploadCard prepends
            // (`${scoutId}/${Date.now()}-${name}`).
            if (f) setFileName(f.replace(/^\d+-/, ""));
          }),
      );
    }
    void Promise.all(tasks);
    return () => {
      cancelled = true;
    };
  }, [id, key]);

  // R6 § L.3: unrecognized-code fallback redirects to UNKNOWN instead of
  // rendering the inline "We don't recognize this error code" panel. The
  // replace flag swaps history so the bad code isn't kept in the back stack.
  if (!cfg) {
    return (
      <Navigate
        to={`/venue-scout/scouts/${id}/deck/error/UNKNOWN`}
        replace
      />
    );
  }

  async function onPrimary() {
    if (!id || retrying) return;
    if (cfg.primaryAction === "none") return;
    setRetrying(true);
    try {
      if (
        cfg.primaryAction === "research" ||
        cfg.primaryAction === "retry-research"
      ) {
        await supabase
          .from("vs_scouts")
          .update({
            current_step: "researching",
            last_touched_at: new Date().toISOString(),
          })
          .eq("id", id);
        nav(`/venue-scout/scouts/${id}/sourcing/researching`);
        return;
      }
      if (cfg.primaryAction === "retry-compile") {
        await supabase
          .from("vs_scouts")
          .update({
            current_step: "compiling",
            last_touched_at: new Date().toISOString(),
          })
          .eq("id", id);
        nav(`/venue-scout/scouts/${id}/sourcing/compiling`);
        return;
      }
      if (cfg.primaryAction === "back-to-deck-prep") {
        nav(`/venue-scout/scouts/${id}/review`);
        return;
      }
    } finally {
      // Navigation unmounts this component on success, but in the error
      // path (or back-to-deck-prep without a write) the flag clears so
      // the button is clickable again.
      setRetrying(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* ---- Top strip: gear icon right-aligned ----
          R6 § L.2: ScoutPhaseBreadcrumb removed from the error chrome (the
          error pages no longer carry a stepper since the producer isn't
          navigating through phases here). ScoutSettingsLink stays so the
          producer can still reach Settings during an error. */}
      <div className="flex items-center justify-end">
        <ScoutSettingsLink scoutId={id} />
      </div>

      {/* ---- Centered error panel ----
          R6 amendment v1 § 7: phase eyebrow ("REVIEW" / "SOURCING") above
          the title removed. Icon now flows directly into the h1; mt-6 on
          the h1 carries the visual balance that the eyebrow + mt-2 stack
          previously provided. */}
      <div className="flex min-h-[60vh] flex-col items-center justify-center px-8 py-12">
        <Icon kind={cfg.icon} />
        <h1 className="h-page mt-6 text-center">{cfg.title}</h1>
        <p className="mt-5 max-w-xl text-center text-sm leading-relaxed text-muted-foreground">
          {cfg.description({ fileName })}
        </p>

        <Card className="mt-8 w-full max-w-xl bg-surface-alt">
          <CardContent className="p-6">
            <div className="label-section mb-3">{cfg.helpTitle}</div>
            {cfg.help}
          </CardContent>
        </Card>

        {/* ---- pipeline_error debug detail (collapsed by default) ---- */}
        {scout?.pipeline_error && (
          <details className="mt-4 w-full max-w-xl">
            <summary className="cursor-pointer text-[11px] font-mono uppercase tracking-wider text-muted-foreground hover:text-foreground">
              Debug detail
            </summary>
            <pre className="mt-2 whitespace-pre-wrap break-words rounded bg-input p-3 text-[11px] font-mono text-muted-foreground">
              {scout.pipeline_error}
            </pre>
          </details>
        )}

        {/* ---- Action buttons ---- */}
        <div className="mt-8 flex items-center gap-3">
          {cfg.secondaryHref && cfg.secondaryLabel && (
            <Link to={cfg.secondaryHref(id)}>
              <Button variant="ghost">{cfg.secondaryLabel}</Button>
            </Link>
          )}
          {cfg.primaryAction !== "none" && cfg.primaryLabel && (
            <Button
              onClick={() => void onPrimary()}
              disabled={retrying}
            >
              {retrying ? "Working…" : cfg.primaryLabel}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// Three SVG-styled icon variants. Failure variants (x, block) bind to the
// destructive token; warn binds to the canonical warn token (hsl(var(--warn))
// wired in tailwind.config.ts:107).
function Icon({ kind }: { kind: IconKind }) {
  if (kind === "warn") {
    return (
      <div className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-warn text-3xl font-black text-warn">
        !
      </div>
    );
  }
  if (kind === "x") {
    return (
      <div className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-destructive text-3xl font-black text-destructive">
        ×
      </div>
    );
  }
  return (
    <div className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-destructive text-destructive">
      <svg
        width="28"
        height="28"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
      >
        <circle cx="12" cy="12" r="10" />
        <path d="M5 5l14 14" />
      </svg>
    </div>
  );
}
