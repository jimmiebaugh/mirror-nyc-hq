// Phase 5.12.14.3 R7 § D: NewScout-as-modal. Replaces the standalone
// `/venue-scout/scouts/new` page route + NewScout.tsx. Captures only the
// two required fields (client + event name) — every other brief field
// lives on the BriefEvent page that this modal routes into on submit.
//
// Row insert shape mirrors the prior NewScout.tsx exactly (computeScoutName
// + created_by + null brief_data) so the modal is a pure-UI collapse with
// no behavioral change to scout creation.

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { HQFormField } from "@/components/hq/HQFormField";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";
import { computeScoutName } from "@/lib/venue-scout/computeScoutName";

export type NewScoutModalProps = {
  open: boolean;
  onOpenChange: (next: boolean) => void;
};

export function NewScoutModal({ open, onOpenChange }: NewScoutModalProps) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [clientName, setClientName] = useState("");
  const [eventName, setEventName] = useState("");
  const [creating, setCreating] = useState(false);

  // Reset fields when the modal closes so re-opening a second time
  // doesn't surface stale typing from a prior cancelled attempt.
  useEffect(() => {
    if (!open) {
      setClientName("");
      setEventName("");
    }
  }, [open]);

  const canSubmit =
    clientName.trim().length > 0 && eventName.trim().length > 0 && !creating;

  const create = async () => {
    const client = clientName.trim();
    const event = eventName.trim();
    if (!client || !event) return;
    setCreating(true);
    const { data, error } = await supabase
      .from("vs_scouts")
      .insert({
        client_name: client,
        event_name: event,
        name: computeScoutName(client, event),
        created_by: user?.id ?? null,
      })
      .select("id")
      .single();
    setCreating(false);
    if (error || !data) {
      toast({
        title: "Could not create scout",
        description: error?.message ?? "Unknown error",
        variant: "destructive",
      });
      return;
    }
    toast({ title: "Scout created" });
    onOpenChange(false);
    // Lands on BriefEvent — same destination as the old standalone page's
    // post-create navigation (Phase 4.3-port lock).
    navigate(`/venue-scout/scouts/${data.id}/brief/event`);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !creating && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Start a new scout</DialogTitle>
          <DialogDescription>
            Enter the client + event name. You'll fill in the rest of the brief
            on the next step.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <HQFormField label="Client Name" required>
            <Input
              autoFocus
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              placeholder="e.g. Hennessy"
              onKeyDown={(e) => {
                if (e.key === "Enter" && canSubmit) {
                  e.preventDefault();
                  void create();
                }
              }}
            />
          </HQFormField>
          <HQFormField label="Event Name" required>
            <Input
              value={eventName}
              onChange={(e) => setEventName(e.target.value)}
              placeholder="e.g. Hennessy V.S Launch"
              onKeyDown={(e) => {
                if (e.key === "Enter" && canSubmit) {
                  e.preventDefault();
                  void create();
                }
              }}
            />
          </HQFormField>
        </div>
        <DialogFooter>
          <Button
            variant="ghost"
            disabled={creating}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button disabled={!canSubmit} onClick={() => void create()}>
            {creating ? "Creating…" : "Create scout"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
