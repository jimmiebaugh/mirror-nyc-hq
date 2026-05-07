import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Stepper } from "@/components/talent-scout/Stepper";
import { TagInput } from "@/components/talent-scout/TagInput";
import { wizard, type WizardStep2 } from "@/lib/talent-scout/wizardStore";
import { toast } from "@/hooks/use-toast";
import type { Database } from "@/integrations/supabase/types";

type AutoPullSchedule = Database["public"]["Enums"]["ts_role_auto_pull_schedule"];

const SCHEDULE_OPTIONS: { value: AutoPullSchedule; label: string }[] = [
  { value: "off", label: "Off (manual only)" },
  { value: "daily", label: "Daily" },
  { value: "every_3_days", label: "Every 3 days" },
  { value: "weekly", label: "Weekly" },
];

export default function NewRoleSearch() {
  const navigate = useNavigate();
  const today = new Date().toISOString().slice(0, 10);
  const existing = wizard.get().step2;
  const [form, setForm] = useState<WizardStep2>(() =>
    existing ?? {
      email_keywords: [],
      email_search_start_date: today,
      auto_pull_schedule: "off",
    },
  );

  useEffect(() => {
    if (!wizard.get().step1) navigate("/talent-scout/new/details", { replace: true });
  }, [navigate]);

  const onContinue = () => {
    if (form.email_keywords.length === 0) {
      toast({
        title: "Need at least one subject keyword",
        description: "Add a subject-line variant (e.g. Senior Producer Application) and press Enter.",
        variant: "destructive",
      });
      return;
    }
    wizard.setStep2(form);
    navigate("/talent-scout/new/scorecard");
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Stepper active={2} />
      <header className="space-y-2">
        <div className="text-xs font-mono uppercase tracking-widest text-primary">Talent Scout · New Role</div>
        <h1 className="h-page">Email search</h1>
        <p className="text-sm text-muted-foreground">
          How to find applicants for this role in the jobs@mirrornyc.com inbox.
        </p>
      </header>

      <Card>
        <CardContent className="space-y-6 p-6">
          <div className="space-y-2">
            <Label className="text-[13px] font-mono font-bold uppercase tracking-wider text-primary">
              Subject line keywords
              <span className="ml-2 text-[11px] font-normal normal-case tracking-normal text-muted-foreground">
                Add every variant you want to catch · press Enter
              </span>
            </Label>
            <TagInput
              value={form.email_keywords}
              onChange={(v) => setForm((f) => ({ ...f, email_keywords: v }))}
              placeholder="Add keyword…"
              normalize
            />
            <p className="text-xs text-muted-foreground">
              Case-insensitive match against the email subject line. More variants = better coverage.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label className="text-[13px] font-mono font-bold uppercase tracking-wider text-primary">
                Start pulling from
              </Label>
              <Input
                type="date"
                value={form.email_search_start_date}
                onChange={(e) => setForm((f) => ({ ...f, email_search_start_date: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">
                Defaults to today. Pulls only emails received after this date.
              </p>
            </div>

            <div className="space-y-2">
              <Label className="text-[13px] font-mono font-bold uppercase tracking-wider text-primary">
                Scheduled auto-pull
                <span className="ml-2 text-[11px] font-normal normal-case tracking-normal text-muted-foreground">Optional</span>
              </Label>
              <RadioGroup
                value={form.auto_pull_schedule}
                onValueChange={(v) =>
                  setForm((f) => ({ ...f, auto_pull_schedule: v as AutoPullSchedule }))
                }
                className="space-y-2"
              >
                {SCHEDULE_OPTIONS.map((opt) => (
                  <div key={opt.value} className="flex items-center gap-2">
                    <RadioGroupItem value={opt.value} id={`sched-${opt.value}`} />
                    <Label htmlFor={`sched-${opt.value}`} className="text-sm font-normal">
                      {opt.label}
                    </Label>
                  </div>
                ))}
              </RadioGroup>
              <p className="text-xs text-muted-foreground">
                Hiring manager gets an email summary after each scheduled pull.
              </p>
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-border pt-6">
            <Button variant="ghost" onClick={() => navigate("/talent-scout/new/details")}>
              ← Back
            </Button>
            <Button onClick={onContinue}>Generate scorecard →</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
