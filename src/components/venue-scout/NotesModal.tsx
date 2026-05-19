import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

// Lifted from VS Pro (src/components/sourcing/NotesModal.tsx). Single adapt:
// the save action UPDATEs the inline `vs_candidate_venues.notes` column
// instead of upserting into the (collapsed) `venue_notes` table. See port
// plan § 2 + § 8.

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  venueId: string | null;
  venueName: string;
  initialContent: string;
  onSaved: (content: string) => void;
};

export function NotesModal({
  open,
  onOpenChange,
  venueId,
  venueName,
  initialContent,
  onSaved,
}: Props) {
  const [content, setContent] = useState(initialContent);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setContent(initialContent);
  }, [initialContent, venueId, open]);

  async function save() {
    if (!venueId) return;
    setSaving(true);
    const { error } = await supabase
      .from("vs_candidate_venues")
      .update({ notes: content })
      .eq("id", venueId);
    setSaving(false);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      return;
    }
    onSaved(content);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-xs font-bold uppercase tracking-[0.18em]">
            Notes &amp; Feedback
          </DialogTitle>
        </DialogHeader>
        <div className="text-sm">
          <span className="font-bold">{venueName}</span>
          <span className="text-muted-foreground/60 mx-2">·</span>
          <span className="text-muted-foreground">
            Notes will appear in the pitch deck context for this venue
          </span>
        </div>
        <Textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={6}
          autoFocus
          placeholder="Notes, feedback, considerations to flag for the pitch deck. Anything to know about this venue when generating the summary."
          className="font-normal text-sm leading-relaxed"
        />
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={save}
            disabled={saving}
            className="bg-primary text-primary-foreground hover:bg-primary/90 font-bold uppercase tracking-[0.14em] text-xs"
          >
            {saving ? "Saving…" : "Save Notes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
