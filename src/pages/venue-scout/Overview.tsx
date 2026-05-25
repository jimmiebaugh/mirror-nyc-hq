// Phase 5.12.14: VS Flow Overview page. Pre-scout onboarding gate that
// producers land on when they click + New Project (from ScoutIndex or the
// LeftRail). The "Start a New Scout" CTA routes to NewScout.
//
// Phase 5.12.14.3 R5 § B1: surfaces the canonical sheet upload template
// (`public/templates/venue-scout-sheet-template.csv`) as a download link
// below the page header.
//
// R6 § C: top-aligned CTA + crumb-to-dashboard + canonical card chrome +
// "What You Get" rename + coral bold list markers. The bottom action bar
// is retired; the primary CTA lives in the page header (top-right).
import { useState } from "react";
import { Download, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NewScoutModal } from "@/components/venue-scout/NewScoutModal";

export default function Overview() {
  // R7 § D: standalone /scouts/new route retired; Overview CTA opens the
  // NewScoutModal instead. Modal handles the row insert + post-create
  // navigation to BriefEvent.
  const [newScoutOpen, setNewScoutOpen] = useState(false);
  return (
    <div className="stack-6 pb-32">
      <header className="space-y-2">
        {/* R6 § C.1 → R7 amendment v3 § 3: per-page back-crumb retired;
            TopBar carries it globally. */}
        <div className="flex items-center justify-between gap-4">
          <h1 className="h-page">Venue Scout Overview</h1>
          {/* R6 § C.6 + R7 § D: primary CTA in upper-right of header opens
              the NewScoutModal (was navigate to standalone /scouts/new). */}
          <Button onClick={() => setNewScoutOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Start a new scout
          </Button>
        </div>
        <a
          href="/templates/venue-scout-sheet-template.csv"
          download="venue-scout-sheet-template.csv"
          className="inline-flex items-center gap-2 text-sm text-primary hover:underline"
        >
          <Download className="h-4 w-4" />
          Download sheet template (CSV)
        </a>
      </header>

      {/* R6 § C.2: card chrome migrated to .card + .card-headbar + .card-pad
          canon (was shadcn Card + CardContent on bg-surface-alt). Each
          section now reads as its own .h-card titled card matching
          BriefReport + ProjectDetail. */}
      <section className="card">
        <div className="card-headbar">
          <h2 className="h-card">What this is</h2>
        </div>
        <div className="card-pad">
          <p className="text-sm leading-relaxed text-foreground">
            Feed Scout an event brief or enter the event info, along with your
            ideal venue criteria. You can upload a sheet of the venues you've
            already scouted. Then Scout researches venues that align with the
            brief and your venue specs, pulling from Mirror's venue database
            and the web. You curate a shortlist of the best matches and
            manually add any others you find. Scout supplements the missing
            venue info for you.
          </p>
        </div>
      </section>

      <section className="card">
        <div className="card-headbar">
          <h2 className="h-card">How it works</h2>
        </div>
        <div className="card-pad">
          {/* R6 § C.3: bold step labels flipped to coral (text-primary) so the
              numbered list reads with stronger visual rhythm. */}
          <ol className="space-y-4 text-sm leading-relaxed">
            <li>
              <strong className="text-primary">1. Brief.</strong>{" "}
              Define the client and event name. Upload a brief if you have
              one, or manually enter the event info along with your ideal
              venue criteria. The brief drives every step through the scout.
            </li>
            <li>
              <strong className="text-primary">2. Sourcing.</strong>{" "}
              Scout surfaces candidate venues aligned with the brief from
              the Venue database and web research. You select which to
              advance.
            </li>
            <li>
              <strong className="text-primary">3. Shortlist.</strong>{" "}
              Curate the venues you want to pitch.
            </li>
            <li>
              <strong className="text-primary">4. Review.</strong>{" "}
              Scout compiles a Venue Overview and supplements any missing
              info. You make final-pass edits, upload photos, and arrange
              venues in their pitch order.
            </li>
            <li>
              <strong className="text-primary">5. Generate Deck.</strong>{" "}
              Scout compiles your curated venues into the Mirror deck
              template and creates a deck in Google Slides.
            </li>
          </ol>
        </div>
      </section>

      <section className="card">
        <div className="card-pad grid grid-cols-1 gap-6 sm:grid-cols-2">
          <div className="space-y-3">
            {/* R6 § C.4: rewritten list. */}
            <div className="label-section">What you bring</div>
            <ul className="list-disc space-y-1 pl-5 text-sm">
              <li>Client + Event name</li>
              <li>A brief (upload PDF or manually enter)</li>
              <li>Venue criteria: type, size, neighborhood, vibe</li>
              <li>Sourcing sheet of researched venues (optional)</li>
            </ul>
          </div>
          <div className="space-y-3">
            {/* R6 § C.5: title rename + rewritten list. */}
            <div className="label-section">What you get</div>
            <ul className="list-disc space-y-1 pl-5 text-sm">
              <li>A completed Mirror-branded Venue Deck in Google Slides</li>
              <li>Research and recommendations per the brief or all venues</li>
              <li>Newly sourced venues filled into Mirror's Venue database</li>
            </ul>
          </div>
        </div>
      </section>

      {/* R6 § C.6: bottom action bar retired. CTA lives in the header. */}

      {/* R7 § D: NewScout modal opens from the header CTA. */}
      <NewScoutModal
        open={newScoutOpen}
        onOpenChange={setNewScoutOpen}
      />
    </div>
  );
}
