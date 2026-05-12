// Phase 4.4-port: drop a PDF / XLSX / CSV sourcing sheet, parse into
// vs_candidate_venues via vs-parse-sheet edge function, then Continue ->
// /sourcing/researching. VS Pro layout authority (port plan § 3, Adapt:
// swap bucket, use HQ DropZone, swap edge function name + payload).
//
// VS Pro source: src/pages/sourcing/SheetUpload.tsx (~111 lines).
//
// Substitutions:
//   surface           -> Card + bg-surface-alt
//   surface-2         -> bg-input
//   .h-section        -> .label-section
//   bucket sourcing-sheets -> sourcing_sheets (HQ convention; underscore)
//   project_id        -> scout_id
//   parse-sheet       -> vs-parse-sheet
//   text-[hsl(var(--success))] -> text-green-400 (HQ has no --success token)
//   80-line inline dropzone   -> <DropZone /> (4.3-port canonical)
//   /projects/:id     -> /venue-scout/scouts/:id
//   /sourcing/error/  -> /venue-scout/scouts/:id/sourcing/error/ (route prefix)
//
// State machine: idle | uploading | parsing | done | error. Stale parse
// race guarded via parseGenRef (same pattern 4.2-port openDelete + 4.3-port
// upload-gen-counter use).

import { useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DropZone } from "@/components/ui/DropZone";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

type Status = "idle" | "uploading" | "parsing" | "done" | "error";

const MAX_SHEET_SIZE_MB = 25;
const ALLOWED_EXTS = new Set(["pdf", "xlsx", "csv"]);

export default function SheetUpload() {
  const { id: scoutId } = useParams();
  const navigate = useNavigate();
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [count, setCount] = useState<number | null>(null);
  // Ignore stale parse responses if the producer rapidly drops a second
  // file mid-parse. Same pattern as 4.2-port (openDelete race) + 4.3-port
  // (Brief upload race).
  const parseGenRef = useRef(0);

  const resetFile = () => {
    setFile(null);
    setStatus("idle");
    setCount(null);
  };

  async function handleFile(f: File | undefined) {
    if (!f || !scoutId) return;

    // Code-reviewer SHOULD FIX 2: reject re-entry while the prior upload
    // hasn't reached a terminal state. parseGenRef already prevents stale
    // responses from clobbering form state, but it doesn't stop two
    // concurrent uploads from racing through the full upload + parse
    // pipeline (doubling API load + leaving an orphan storage object).
    // Idle / done / error are the resumable states.
    if (status !== "idle" && status !== "done" && status !== "error") {
      return;
    }

    // DropZone already enforces accept + maxSizeMb, but keep defense-in-
    // depth checks so a buggy DropZone or future API change can't slip
    // bad input through.
    if (f.size > MAX_SHEET_SIZE_MB * 1024 * 1024) {
      toast({ title: "File exceeds 25MB", variant: "destructive" });
      return;
    }
    const ext = f.name.toLowerCase().split(".").pop() ?? "";
    if (!ALLOWED_EXTS.has(ext)) {
      toast({ title: "Use PDF, XLSX, or CSV", variant: "destructive" });
      return;
    }

    const myGen = ++parseGenRef.current;
    setFile(f);
    setStatus("uploading");

    try {
      // VS Pro path: ${project_id}/${Date.now()}-${name}. HQ: scope to
      // scout_id. upsert:true matches VS Pro behavior so a repeat upload of
      // the same name overwrites cleanly.
      const path = `${scoutId}/${Date.now()}-${f.name}`;
      const { error: upErr } = await supabase.storage
        .from("sourcing_sheets")
        .upload(path, f, { upsert: true });
      if (myGen !== parseGenRef.current) return;
      if (upErr) {
        setStatus("error");
        toast({
          title: "Upload failed",
          description: upErr.message,
          variant: "destructive",
        });
        return;
      }

      setStatus("parsing");
      const { data, error } = await supabase.functions.invoke("vs-parse-sheet", {
        body: { scout_id: scoutId, storage_path: path },
      });
      if (myGen !== parseGenRef.current) return;

      if (error) {
        setStatus("error");
        navigate(
          `/venue-scout/scouts/${scoutId}/sourcing/error/parse-fail`,
        );
        return;
      }
      const responseError = (data as { error?: string } | null)?.error;
      if (responseError) {
        setStatus("error");
        navigate(
          `/venue-scout/scouts/${scoutId}/sourcing/error/parse-fail`,
        );
        return;
      }

      const parsedCount = (data as { count?: number } | null)?.count ?? 0;
      if (parsedCount === 0) {
        navigate(
          `/venue-scout/scouts/${scoutId}/sourcing/error/empty-sheet`,
        );
        return;
      }
      setCount(parsedCount);
      setStatus("done");
    } catch (e) {
      if (myGen !== parseGenRef.current) return;
      setStatus("error");
      toast({
        title: "Upload failed",
        description: e instanceof Error ? e.message : "Unexpected error",
        variant: "destructive",
      });
    }
  }

  async function onContinue() {
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

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <div className="text-[14px] font-mono uppercase tracking-widest text-primary">
          Sourcing
        </div>
        <h1 className="h-page">Upload Sourcing Sheet</h1>
        <p className="text-sm text-muted-foreground">
          Drop your existing venue sourcing sheet. We'll parse the venues into the candidate list.
        </p>
      </header>

      <Card className="bg-surface-alt">
        <CardContent className="p-8">
          <div className="mb-6 flex items-center justify-between">
            <span className="label-section">Sheet Upload</span>
          </div>

          <DropZone
            accept=".pdf,.xlsx,.csv"
            multiple={false}
            maxSizeMb={MAX_SHEET_SIZE_MB}
            hint="PDF, XLSX, or CSV · up to 25MB"
            files={file ? [file] : []}
            onAdd={(added) => void handleFile(added[0])}
            onRemove={() => resetFile()}
          />

          {status === "uploading" && (
            <div className="mt-4 text-xs text-muted-foreground">Uploading…</div>
          )}
          {status === "parsing" && (
            <div className="mt-4 text-xs text-muted-foreground">Parsing venues…</div>
          )}
          {status === "done" && count != null && (
            <div className="mt-4 rounded-md bg-input px-4 py-3 text-sm">
              <span className="font-semibold text-green-400">✓ Parsed</span>
              <span className="mx-2 text-muted-foreground">·</span>
              <strong>{count} venues</strong>{" "}
              <span className="text-muted-foreground">detected</span>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center justify-between border-t border-border pt-6">
        <Link
          to={`/venue-scout/scouts/${scoutId}/sourcing/sheet-prompt`}
          className="crumb inline-flex items-center gap-1"
        >
          <ArrowLeft className="h-3 w-3" /> Back
        </Link>
        <Button onClick={onContinue} disabled={status !== "done"}>
          Continue · Research →
        </Button>
      </div>
    </div>
  );
}
