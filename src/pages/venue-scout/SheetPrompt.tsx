// Phase 4.4-port: Sourcing-sheet branch point. Producer picks "Yes I have
// one" (-> /sourcing/sheet-upload) or "No, let's research" (-> /sourcing/
// researching, still 404 until 4.5-port lands). VS Pro layout authority --
// port plan § 3 marks SheetPrompt as Lift with HQ token swaps only.
//
// VS Pro source: src/pages/sourcing/SheetPrompt.tsx (~55 lines).
//
// Token swaps from VS Pro:
//   surface           -> bg-surface-alt
//   surface-2         -> bg-input
//   PageHeader        -> inline header block (HQ doesn't have a shared
//                        PageHeader component; the eyebrow + h-page + muted
//                        description pattern is repeated inline in HQ).
//   btn btn-ghost btn-sm -> .crumb class (HQ back-link convention).
//   /projects/:id     -> /venue-scout/scouts/:id (route prefix swap).

import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ArrowUp, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import {
  ScoutSettingsLink,
  ScoutStepThroughNav,
} from "@/components/venue-scout/ScoutChrome";

export default function SheetPrompt() {
  const { id: scoutId } = useParams();
  const navigate = useNavigate();

  async function go(step: "sheet_upload" | "researching", path: string) {
    if (!scoutId) return;
    const { error } = await supabase
      .from("vs_scouts")
      .update({
        current_step: step,
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
    navigate(path);
  }

  return (
    <div className="space-y-8">
      <header className="flex items-end justify-between gap-5">
        <div className="space-y-2">
          <div className="text-[14px] font-mono uppercase tracking-widest text-primary">
            Sourcing
          </div>
          <h1 className="h-page">Sourcing Sheet</h1>
          <p className="text-sm text-muted-foreground">
            Do you have a venue sourcing sheet to upload?
          </p>
        </div>
        {scoutId && <ScoutSettingsLink scoutId={scoutId} />}
      </header>
      {scoutId && <ScoutStepThroughNav scoutId={scoutId} />}

      <div className="mx-auto grid max-w-3xl grid-cols-1 gap-6 md:grid-cols-2">
        <button
          type="button"
          onClick={() =>
            go(
              "sheet_upload",
              `/venue-scout/scouts/${scoutId}/sourcing/sheet-upload`,
            )
          }
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
          onClick={() =>
            go(
              "researching",
              `/venue-scout/scouts/${scoutId}/sourcing/researching`,
            )
          }
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

      <div className="mx-auto mt-16 max-w-3xl border-t border-border pt-8">
        <Link
          to={`/venue-scout/scouts/${scoutId}/brief`}
          className="crumb inline-flex items-center gap-1"
        >
          <ArrowLeft className="h-3 w-3" /> Back to Brief
        </Link>
      </div>
    </div>
  );
}
