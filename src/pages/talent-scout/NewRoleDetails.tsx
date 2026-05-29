import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { HQFormField } from "@/components/hq/HQFormField";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Stepper } from "@/components/ui/Stepper";
import { TS_WIZARD_STEPS, wizard, type WizardStep1 } from "@/lib/talent-scout/wizardStore";
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
    <div className="mx-auto max-w-3xl space-y-6 pb-32">
      <div className="eyebrow mb-2">New Role</div>
      <Stepper steps={TS_WIZARD_STEPS} active={1} />
      <header className="space-y-2">
        <h1 className="h-page">Role details</h1>
      </header>

      <section className="card">
        <div className="card-pad space-y-6">
          <HQFormField label="Role title" required>
            <Input value={form.title} onChange={(e) => update("title", e.target.value)} placeholder="e.g. Senior Producer" />
          </HQFormField>

          <HQFormField label={<>Job Description <span className="text-primary font-normal normal-case tracking-normal ml-2">Paste the full JD</span></>} required>
            <Textarea
              className="min-h-[180px]"
              value={form.job_description}
              onChange={(e) => update("job_description", e.target.value)}
              placeholder="Paste the full job description here…"
            />
          </HQFormField>

          <div className="grid gap-4 md:grid-cols-3">
            <HQFormField label="Location">
              <Input value={form.location} onChange={(e) => update("location", e.target.value)} />
            </HQFormField>
            <HQFormField label="Type">
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
            </HQFormField>
            <HQFormField label="Start date">
              <Input value={form.start_date} onChange={(e) => update("start_date", e.target.value)} />
            </HQFormField>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <HQFormField label="Compensation">
              <Input
                placeholder="e.g. $85k to $110k"
                value={form.compensation}
                onChange={(e) => update("compensation", e.target.value)}
              />
            </HQFormField>
            <HQFormField label="Hiring manager" required>
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
            </HQFormField>
          </div>

          <HQFormField label={<>Additional Priorities Not in JD <span className="text-primary font-normal normal-case tracking-normal ml-2">(Optional)</span></>}>
            <Textarea
              className="min-h-[100px]"
              placeholder="e.g. needs to run pitches solo, culture fit critical, must have managed direct reports"
              value={form.hiring_priorities}
              onChange={(e) => update("hiring_priorities", e.target.value)}
            />
          </HQFormField>

          <HQFormField label={<>Auto-Rejection Threshold <span className="text-primary font-normal normal-case tracking-normal ml-2">Candidates scored below this are auto-rejected</span></>}>
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
          </HQFormField>
        </div>
      </section>

      <div className="actionbar">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-6 py-4">
          <button
            type="button"
            className="btn btn-tertiary"
            onClick={() => navigate("/talent-scout")}
          >
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={onContinue}>
            Continue →
          </button>
        </div>
      </div>
    </div>
  );
}

