import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Stepper } from "@/components/talent-scout/Stepper";
import { wizard, type WizardStep1 } from "@/lib/talent-scout/wizardStore";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

type AdminUser = { id: string; email: string; full_name: string | null };

const blankForm = (): WizardStep1 => ({
  title: "",
  job_description: "",
  location: "New York, NY",
  type: "Full-Time",
  start_date: "ASAP",
  compensation: "Based on Experience",
  hiring_manager_id: null,
  hiring_manager_name: "",
  hiring_manager_email: "",
  hiring_priorities: "",
  auto_rejection_threshold: 60,
});

export default function NewRoleDetails() {
  const navigate = useNavigate();
  const [form, setForm] = useState<WizardStep1>(() => wizard.get().step1 ?? blankForm());
  const [admins, setAdmins] = useState<AdminUser[]>([]);

  useEffect(() => {
    supabase
      .from("users")
      .select("id, email, full_name")
      .eq("permission_role", "admin")
      .eq("active", true)
      .order("full_name", { ascending: true })
      .then(({ data }) => setAdmins((data ?? []) as AdminUser[]));
  }, []);

  const update = <K extends keyof WizardStep1>(k: K, v: WizardStep1[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const onContinue = () => {
    if (!form.title.trim() || !form.job_description.trim()) {
      toast({
        title: "Missing required fields",
        description: "Role title and job description are required.",
        variant: "destructive",
      });
      return;
    }
    if (!form.hiring_manager_id) {
      toast({
        title: "Hiring manager required",
        description:
          "Pick an admin from the dropdown. If the person you want isn't in the list, they need to sign in to HQ at least once first.",
        variant: "destructive",
      });
      return;
    }
    wizard.setStep1(form);
    navigate("/talent-scout/new/search");
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Stepper active={1} />
      <header className="space-y-2">
        <div className="text-[14px] font-mono uppercase tracking-widest text-primary">Talent Scout · New Role</div>
        <h1 className="h-page">Role details</h1>
        <p className="text-sm text-muted-foreground">
          Tell us about the role. We'll generate a scorecard from this in step 3.
        </p>
      </header>

      <Card>
        <CardContent className="space-y-6 p-6">
          <Field label="Role title" required>
            <Input value={form.title} onChange={(e) => update("title", e.target.value)} placeholder="e.g. Senior Producer" />
          </Field>

          <Field label="Job description" hint="Paste the full JD" required>
            <Textarea
              className="min-h-[180px]"
              value={form.job_description}
              onChange={(e) => update("job_description", e.target.value)}
              placeholder="Paste the full job description here…"
            />
          </Field>

          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Location">
              <Input value={form.location} onChange={(e) => update("location", e.target.value)} />
            </Field>
            <Field label="Type">
              <Select value={form.type} onValueChange={(v) => update("type", v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Full-Time">Full-Time</SelectItem>
                  <SelectItem value="Contract">Contract</SelectItem>
                  <SelectItem value="Freelance">Freelance</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Start date">
              <Input value={form.start_date} onChange={(e) => update("start_date", e.target.value)} />
            </Field>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Compensation">
              <Input
                placeholder="e.g. $85k–$110k"
                value={form.compensation}
                onChange={(e) => update("compensation", e.target.value)}
              />
            </Field>
            <Field
              label="Hiring manager"
              hint="Picks from admin users. Manager must sign in to HQ at least once first."
              required
            >
              <Select
                value={form.hiring_manager_id ?? undefined}
                onValueChange={(id) => {
                  const a = admins.find((x) => x.id === id);
                  setForm((f) => ({
                    ...f,
                    hiring_manager_id: id || null,
                    hiring_manager_name: a?.full_name ?? "",
                    hiring_manager_email: a?.email ?? "",
                  }));
                }}
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={admins.length === 0 ? "No admin users found" : "Select admin…"}
                  />
                </SelectTrigger>
                <SelectContent>
                  {admins.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.full_name ?? a.email} {a.full_name ? `· ${a.email}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          <Field label="Hiring priorities not in JD" hint="Optional · free text">
            <Textarea
              className="min-h-[100px]"
              placeholder="e.g. needs to run pitches solo, culture fit critical, must have managed direct reports"
              value={form.hiring_priorities}
              onChange={(e) => update("hiring_priorities", e.target.value)}
            />
          </Field>

          <Field label="Auto-rejection threshold" hint="Candidates scoring below this are auto-rejected">
            <div className="space-y-2">
              <Slider
                min={0}
                max={100}
                step={1}
                value={[form.auto_rejection_threshold]}
                onValueChange={(v) => update("auto_rejection_threshold", v[0] ?? 0)}
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>0</span>
                <span className="font-bold text-primary">{form.auto_rejection_threshold} / 100</span>
                <span>100</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Tier 1 (Must-Have) gaps will auto-reject regardless of total score.
              </p>
            </div>
          </Field>

          <div className="flex items-center justify-between gap-3 border-t border-border pt-6">
            <Button variant="ghost" onClick={() => navigate("/talent-scout")}>
              ← Cancel
            </Button>
            <Button onClick={onContinue}>Continue →</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label className="text-[13px] font-mono font-bold uppercase tracking-wider text-primary">
        {label}
        {required && <span className="ml-1 text-primary">*</span>}
        {hint && <span className="ml-2 text-[11px] font-normal normal-case tracking-normal text-muted-foreground">{hint}</span>}
      </Label>
      {children}
    </div>
  );
}
