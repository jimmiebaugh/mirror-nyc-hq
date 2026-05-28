import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Stepper } from "@/components/ui/Stepper";
import { HQFormField } from "@/components/hq/HQFormField";
import { TagInput } from "@/components/talent-scout/TagInput";
import { TS_WIZARD_STEPS, wizard, type WizardStep2 } from "@/lib/talent-scout/wizardStore";
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
    <div className="mx-auto max-w-3xl space-y-6 pb-32">
      <div className="eyebrow mb-2">New Role</div>
      <Stepper steps={TS_WIZARD_STEPS} active={2} />
      <header className="space-y-2">
        <h1 className="h-page">Email search</h1>
      </header>

      <div className="hq-explainer">
        <div className="hq-explainer-label">Tip</div>
        <p className="hq-explainer-body">How applicants are searched for this role in the jobs@mirrornyc.com inbox. Subject lines matching ANY of the keywords entered below are pulled.</p>
      </div>

      <section className="card">
        <div className="card-pad space-y-6">
          <HQFormField label="Subject line keywords">
            <TagInput
              value={form.email_keywords}
              onChange={(v) => setForm((f) => ({ ...f, email_keywords: v }))}
              placeholder="Add keyword and press enter..."
              normalize
            />
          </HQFormField>

          <div className="grid gap-4 md:grid-cols-2">
            <HQFormField label="Start pulling from">
              <Input
                type="date"
                value={form.email_search_start_date}
                onChange={(e) => setForm((f) => ({ ...f, email_search_start_date: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">
                Defaults to today. Pulls only emails received after this date.
              </p>
            </HQFormField>

            <HQFormField label="Scheduled auto-pull">
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
            </HQFormField>
          </div>
        </div>
      </section>

      <div className="actionbar">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-6 py-4">
          <Button variant="ghost" className="text-primary" onClick={() => navigate("/talent-scout/new/details")}>
            Back
          </Button>
          <Button onClick={onContinue}>Generate scorecard →</Button>
        </div>
      </div>
    </div>
  );
}
