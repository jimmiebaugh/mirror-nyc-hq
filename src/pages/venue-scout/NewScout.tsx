import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";
import { computeScoutName } from "@/lib/venue-scout/computeScoutName";
import { stepToRoute } from "@/lib/venue-scout/format";

export default function NewScout() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [clientName, setClientName] = useState("");
  const [eventName, setEventName] = useState("");
  const [creating, setCreating] = useState(false);
  const [confirmLeaveOpen, setConfirmLeaveOpen] = useState(false);

  const dirty = clientName.trim().length > 0 || eventName.trim().length > 0;

  const onCancel = () => {
    if (dirty) {
      setConfirmLeaveOpen(true);
      return;
    }
    navigate("/venue-scout");
  };

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
      .select("id, current_step")
      .single();
    setCreating(false);
    if (error || !data) {
      toast({
        title: "Could not create project",
        description: error?.message ?? "Unknown error",
        variant: "destructive",
      });
      return;
    }
    toast({ title: "Project created" });
    navigate(stepToRoute(data.id, data.current_step));
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link to="/venue-scout" className="crumb">
        ← Back to Venue Scout
      </Link>
      <header className="space-y-2">
        <h1 className="h-page">New Project</h1>
        <p className="text-sm text-muted-foreground">
          Name the project, then fill in the brief on the next step.
        </p>
      </header>

      <Card className="bg-surface-alt">
        <CardContent className="space-y-6 p-8">
          <Field label="Client name" required>
            <Input
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              placeholder="e.g. Hennessy"
            />
          </Field>

          <Field label="Event name" required>
            <Input
              value={eventName}
              onChange={(e) => setEventName(e.target.value)}
              placeholder="e.g. Hennessy V.S Launch"
            />
          </Field>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between gap-3 border-t border-border pt-6">
        <Button variant="ghost" onClick={onCancel}>
          ← Cancel
        </Button>
        <Button
          onClick={create}
          disabled={!clientName.trim() || !eventName.trim() || creating}
        >
          {creating ? "Creating…" : "Create Project"}
        </Button>
      </div>

      <AlertDialog open={confirmLeaveOpen} onOpenChange={setConfirmLeaveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard new project?</AlertDialogTitle>
            <AlertDialogDescription>
              You've started filling in this project. Leave anyway and lose what you typed, or stay
              on this page?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setConfirmLeaveOpen(false)}>Stay</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmLeaveOpen(false);
                navigate("/venue-scout");
              }}
            >
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label className="text-[13px] font-mono font-bold uppercase tracking-wider text-primary">
        {label}
        {required && <span className="ml-1 text-primary">*</span>}
      </Label>
      {children}
    </div>
  );
}
