// Phase 5.12.14.1 Stage 2C item 4: extracted from the deleted SheetUpload
// page. Renders the drop-zone + parse status + Continue button. The merged
// SheetPrompt page mounts this below the Yes/No cards once the producer
// confirms "Yes, I have one".
//
// Lifted verbatim (with state + handlers contained in this component): the
// DropZone, status state machine, stale-parse race protection via
// parseGenRef, error routing, and the Continue handler that flips
// current_step to "researching" + navigates to /sourcing/researching.

import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DropZone } from "@/components/ui/DropZone";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

// Phase 4.10.3-port: AI enrichment moved out of vs-parse-sheet and into
// vs-research-venues (Phase A). Parse is now a sub-second operation;
// producer sees Parsing -> Done.
type Status = "idle" | "uploading" | "parsing" | "done" | "error";

const MAX_SHEET_SIZE_MB = 25;
const ALLOWED_EXTS = new Set(["pdf", "xlsx", "csv"]);

export function SheetUploadCard({ scoutId }: { scoutId: string }) {
  const navigate = useNavigate();
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [count, setCount] = useState<number | null>(null);
  // Stale-parse race guard: producer drops a second file mid-parse and the
  // first parse response should not clobber the form state. Same pattern
  // 4.2-port openDelete + 4.3-port upload-gen-counter use.
  const parseGenRef = useRef(0);

  const resetFile = () => {
    setFile(null);
    setStatus("idle");
    setCount(null);
  };

  async function handleFile(f: File | undefined) {
    if (!f || !scoutId) return;

    // Reject re-entry while the prior upload hasn't reached a terminal
    // state. parseGenRef alone won't stop two concurrent uploads from
    // racing through the full upload + parse pipeline.
    if (status !== "idle" && status !== "done" && status !== "error") {
      return;
    }

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
      const { data, error } = await supabase.functions.invoke(
        "vs-parse-sheet",
        { body: { scout_id: scoutId, storage_path: path } },
      );
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
    <>
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
              <span className="font-semibold text-success">✓ Parsed</span>
              <span className="mx-2 text-muted-foreground">·</span>
              <strong>{count} venues</strong>{" "}
              <span className="text-muted-foreground">detected</span>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="actionbar">
        <div className="mx-auto flex max-w-3xl items-center justify-end gap-3 px-6 py-4">
          <Button onClick={onContinue} disabled={status !== "done"}>
            Continue · Research →
          </Button>
        </div>
      </div>
    </>
  );
}
