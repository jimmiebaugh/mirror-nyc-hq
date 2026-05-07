import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { TagInput } from "@/components/talent-scout/TagInput";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import type { Database } from "@/integrations/supabase/types";

type RoleRow = Database["public"]["Tables"]["ts_roles"]["Row"];
type RoleUpdate = Database["public"]["Tables"]["ts_roles"]["Update"];
type AutoPullSchedule = Database["public"]["Enums"]["ts_role_auto_pull_schedule"];

type AdminUser = { id: string; email: string; full_name: string | null };

type FormState = {
  title: string;
  job_description: string;
  location: string;
  type: string;
  compensation: string;
  hiring_manager_id: string | null;
  hiring_priorities: string;
  auto_rejection_threshold: number;
  email_keywords: string[];
  email_search_start_date: string;
  auto_pull_schedule: AutoPullSchedule;
};

const SCHEDULE_OPTIONS: { value: AutoPullSchedule; label: string }[] = [
  { value: "off", label: "Off (manual only)" },
  { value: "daily", label: "Daily" },
  { value: "every_3_days", label: "Every 3 days" },
  { value: "weekly", label: "Weekly" },
];

function fromRole(r: RoleRow): FormState {
  return {
    title: r.title ?? "",
    job_description: r.job_description ?? "",
    location: r.location ?? "",
    type: r.type ?? "",
    compensation: r.compensation ?? "",
    hiring_manager_id: r.hiring_manager_id ?? null,
    hiring_priorities: r.hiring_priorities ?? "",
    auto_rejection_threshold: r.auto_rejection_threshold ?? 60,
    email_keywords: r.email_keywords ?? [],
    email_search_start_date: r.email_search_start_date ?? "",
    auto_pull_schedule: r.auto_pull_schedule ?? "off",
  };
}

export default function RoleSettings() {
  const { id } = useParams();
  const nav = useNavigate();
  const [role, setRole] = useState<RoleRow | null>(null);
  const [admins, setAdmins] = useState<AdminUser[]>([]);
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!id) return;
    let active = true;
    (async () => {
      const [{ data: r }, { data: a }] = await Promise.all([
        supabase.from("ts_roles").select("*").eq("id", id).maybeSingle(),
        supabase
          .from("users")
          .select("id, email, full_name")
          .eq("permission_role", "admin")
          .eq("active", true)
          .order("full_name", { ascending: true }),
      ]);
      if (!active) return;
      if (r) {
        setRole(r as RoleRow);
        setForm(fromRole(r as RoleRow));
      }
      setAdmins((a ?? []) as AdminUser[]);
    })();
    return () => {
      active = false;
    };
  }, [id]);

  const update = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => (f ? { ...f, [k]: v } : f));

  if (!role || !form) return <p className="text-sm text-muted-foreground">Loading…</p>;

  const onSave = async () => {
    if (!form.title.trim() || !form.job_description.trim()) {
      toast({ title: "Title and job description are required.", variant: "destructive" });
      return;
    }
    if (!form.hiring_manager_id) {
      toast({ title: "Hiring manager required.", variant: "destructive" });
      return;
    }
    setSaving(true);
    const payload: RoleUpdate = {
      title: form.title,
      job_description: form.job_description,
      location: form.location || null,
      type: form.type || null,
      compensation: form.compensation || null,
      hiring_manager_id: form.hiring_manager_id,
      hiring_priorities: form.hiring_priorities || null,
      auto_rejection_threshold: form.auto_rejection_threshold,
      email_keywords: form.email_keywords,
      email_search_start_date: form.email_search_start_date || null,
      auto_pull_schedule: form.auto_pull_schedule,
    };
    const { error } = await supabase.from("ts_roles").update(payload).eq("id", role.id);
    setSaving(false);
    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Saved" });
    nav(`/talent-scout/roles/${role.id}`);
  };

  const onCloseRole = async () => {
    const { error } = await supabase.from("ts_roles").update({ status: "closed" }).eq("id", role.id);
    if (error) {
      toast({ title: "Close failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Role closed" });
    nav(`/talent-scout/roles/${role.id}`);
  };

  const onReopen = async () => {
    const { error } = await supabase.from("ts_roles").update({ status: "open" }).eq("id", role.id);
    if (error) {
      toast({ title: "Reopen failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Role reopened" });
    nav(`/talent-scout/roles/${role.id}`);
  };

  const isClosed = role.status === "closed";

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="space-y-2">
        <Link to={`/talent-scout/roles/${role.id}`} className="text-[14px] font-mono uppercase tracking-widest text-primary hover:underline">
          ← Back to role
        </Link>
        <h1 className="h-page">Edit role</h1>
        <p className="text-sm text-muted-foreground">{role.title}</p>
      </header>

      <Card>
        <CardContent className="space-y-6 p-6">
          <Field label="Role title" required>
            <Input value={form.title} onChange={(e) => update("title", e.target.value)} />
          </Field>

          <Field label="Job description" required>
            <Textarea
              className="min-h-[180px]"
              value={form.job_description}
              onChange={(e) => update("job_description", e.target.value)}
            />
          </Field>

          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Location">
              <Input value={form.location} onChange={(e) => update("location", e.target.value)} />
            </Field>
            <Field label="Type">
              <Select value={form.type} onValueChange={(v) => update("type", v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Full-Time">Full-Time</SelectItem>
                  <SelectItem value="Contract">Contract</SelectItem>
                  <SelectItem value="Freelance">Freelance</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Compensation">
              <Input value={form.compensation} onChange={(e) => update("compensation", e.target.value)} />
            </Field>
          </div>

          <Field label="Hiring manager" required>
            <Select
              value={form.hiring_manager_id ?? undefined}
              onValueChange={(v) => update("hiring_manager_id", v || null)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select admin…" />
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

          <Field label="Hiring priorities not in JD">
            <Textarea
              className="min-h-[100px]"
              value={form.hiring_priorities}
              onChange={(e) => update("hiring_priorities", e.target.value)}
            />
          </Field>

          <Field label="Auto-rejection threshold">
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
            </div>
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-6 p-6">
          <Field label="Subject line keywords" required>
            <TagInput
              value={form.email_keywords}
              onChange={(v) => update("email_keywords", v)}
              placeholder="Add keyword…"
              normalize
            />
          </Field>

          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Start pulling from">
              <Input
                type="date"
                value={form.email_search_start_date}
                onChange={(e) => update("email_search_start_date", e.target.value)}
              />
            </Field>
            <Field label="Auto-pull schedule">
              <RadioGroup
                value={form.auto_pull_schedule}
                onValueChange={(v) => update("auto_pull_schedule", v as AutoPullSchedule)}
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
            </Field>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex items-center justify-between gap-3 p-5">
          <div className="space-y-1">
            <div className="text-sm font-semibold">Role status</div>
            <p className="text-xs text-muted-foreground">
              {isClosed
                ? "Closed roles stay readable. Auto-pull won't fire and the storage cron will purge attachments after 60 days."
                : "Closing the role stops auto-pulls and pauses re-evaluation."}
            </p>
          </div>
          {isClosed ? (
            <Button variant="outline" onClick={onReopen}>
              Reopen role
            </Button>
          ) : (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive">Close role</Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Close this role?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Auto-pulls stop firing and the role moves to the Closed list.
                    You can reopen it later from this same page.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={onCloseRole}>Close role</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center justify-between gap-3 border-t border-border pt-6">
        <Button variant="ghost" onClick={() => nav(`/talent-scout/roles/${role.id}`)}>
          ← Cancel
        </Button>
        <Button onClick={onSave} disabled={saving}>
          {saving ? "Saving…" : "Save changes"}
        </Button>
      </div>
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
