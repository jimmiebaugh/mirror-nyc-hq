// Phase 5.12.14.1 Stage 2C item 4: merged surface for the old /sourcing/
// sheet-prompt + /sourcing/sheet-upload routes. The producer picks Yes/No;
// Yes minimizes both cards and expands <SheetUploadCard> below. No still
// kicks off /sourcing/researching directly.
//
// Direct-load to /sourcing/sheet-prompt?upload=1 (the route format.ts
// produces for current_step === "sheet_upload") starts on the expanded
// upload view; clicking the minimized No card collapses the upload card
// and restores both choice cards to full size.

import { useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowUp, Check, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { ScoutPageHeader } from "@/components/venue-scout/ScoutPageHeader";

import { SheetUploadCard } from "@/components/venue-scout/SheetUploadCard";

export default function SheetPrompt() {
  const { id: scoutId } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // Auto-expand the upload section when the producer lands here via
  // stepToRoute('sheet_upload'); persists their committed choice across
  // refreshes inside the same nav.
  const [uploadExpanded, setUploadExpanded] = useState(
    searchParams.get("upload") === "1",
  );

  async function chooseYes() {
    if (!scoutId) return;
    const { error } = await supabase
      .from("vs_scouts")
      .update({
        current_step: "sheet_upload",
        last_touched_at: new Date().toISOString(),
      })
      .eq("id", scoutId);
    if (error) {
      toast({
        title: "Couldn't continue",
        description: error.message,
        variant: "destructive",
      });
      return;
    }
    setUploadExpanded(true);
  }

  async function chooseNo() {
    if (!scoutId) return;
    const { error } = await supabase
      .from("vs_scouts")
      .update({
        current_step: "researching",
        last_touched_at: new Date().toISOString(),
      })
      .eq("id", scoutId);
    if (error) {
      toast({
        title: "Couldn't continue",
        description: error.message,
        variant: "destructive",
      });
      return;
    }
    navigate(`/venue-scout/scouts/${scoutId}/sourcing/researching`);
  }

  // Reset both the local UI AND the persisted scout step so the producer's
  // "Change" affordance is a true reversal. Without the DB write, a refresh
  // or resume would re-land on ?upload=1 because stepToRoute('sheet_upload')
  // auto-expands the upload card. CAS-style guarded: only flips the step
  // back when the scout is currently sitting at sheet_upload (defends
  // against late writes if the producer raced through chooseNo).
  async function changeChoice() {
    setUploadExpanded(false);
    if (!scoutId) return;
    const { error } = await supabase
      .from("vs_scouts")
      .update({
        current_step: "sheet_prompt",
        last_touched_at: new Date().toISOString(),
      })
      .eq("id", scoutId)
      .eq("current_step", "sheet_upload");
    if (error) {
      toast({
        title: "Couldn't reset",
        description: error.message,
        variant: "destructive",
      });
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 pb-32">
      <header className="space-y-2">
        {/* R7 amendment v2 § 5: shared ScoutPageHeader. */}
        {scoutId && <ScoutPageHeader scoutId={scoutId} />}
        <h1 className="h-page">Sourcing Sheet</h1>
      </header>

      {uploadExpanded ? (
        <>
          {/* Minimized choice row: "Yes ✓" confirmed; click No (or Change)
              to collapse the upload card and restore both cards full-size. */}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="flex items-center justify-between rounded-md border border-primary/40 bg-primary/5 px-4 py-3">
              <div className="flex items-center gap-3 text-sm">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  <Check className="h-3.5 w-3.5" />
                </span>
                <span className="font-bold uppercase tracking-wide">
                  Yes, I have one
                </span>
              </div>
              <button
                type="button"
                onClick={changeChoice}
                className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground hover:text-foreground"
              >
                Change
              </button>
            </div>
            <button
              type="button"
              onClick={() => void chooseNo()}
              className="flex items-center justify-between rounded-md border border-border bg-surface-alt px-4 py-3 text-left transition-colors hover:bg-input/40"
            >
              <div className="flex items-center gap-3 text-sm">
                <span className="flex h-6 w-6 items-center justify-center rounded bg-input">
                  <Search className="h-3.5 w-3.5" />
                </span>
                <span className="font-bold uppercase tracking-wide text-muted-foreground">
                  No, let's research
                </span>
              </div>
              <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-primary">
                Switch →
              </span>
            </button>
          </div>

          {scoutId && <SheetUploadCard scoutId={scoutId} />}
        </>
      ) : (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <button
            type="button"
            onClick={() => void chooseYes()}
            className="group rounded-md border border-border bg-surface-alt p-8 text-left transition-colors hover:bg-input/40"
          >
            <div className="mb-6 flex h-12 w-12 items-center justify-center rounded bg-input">
              <ArrowUp className="h-5 w-5" />
            </div>
            <h3 className="mb-3 text-base font-bold uppercase tracking-wide">
              Yes, I have one
            </h3>
            <p className="mb-6 text-sm leading-relaxed text-muted-foreground">
              Upload a PDF, XLSX, or CSV. We'll parse the venues into a candidate list and supplement with additional options if needed.
            </p>
            <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-primary">
              Upload Sheet →
            </span>
          </button>

          <button
            type="button"
            onClick={() => void chooseNo()}
            className="group rounded-md border border-border bg-surface-alt p-8 text-left transition-colors hover:bg-input/40"
          >
            <div className="mb-6 flex h-12 w-12 items-center justify-center rounded bg-input">
              <Search className="h-5 w-5" />
            </div>
            <h3 className="mb-3 text-base font-bold uppercase tracking-wide">
              No, let's research
            </h3>
            <p className="mb-6 text-sm leading-relaxed text-muted-foreground">
              Skip ahead and we'll pull candidates based on the brief. You'll see the full candidate matrix on the next screen.
            </p>
            <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-primary">
              Start Research →
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
