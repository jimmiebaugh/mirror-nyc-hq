import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { StickySaveBar } from "@/components/data/StickySaveBar";
import { IconArrowLeft } from "@/components/icons/HQIcons";
import { useLookup } from "@/lib/hq/lookups";
import { InlineAddSelect } from "@/components/data/InlineAddSelect";
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
import { toast } from "@/hooks/use-toast";
import type { PermissionRole } from "@/lib/team/queries";
import { formatLastActive } from "@/lib/team/relativeActive";

type FormState = {
  fullName: string;
  email: string;
  roleTitle: string;
  departmentId: string | null;
  tier: PermissionRole;
  slackHandle: string;
  slackUserId: string;
  active: boolean;
};

const EMPTY: FormState = {
  fullName: "",
  email: "",
  roleTitle: "",
  departmentId: null,
  tier: "standard",
  slackHandle: "",
  slackUserId: "",
  active: true,
};

const TIER_OPTIONS: PermissionRole[] = ["admin", "standard", "freelance"];

function tierLabel(t: PermissionRole): string {
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/**
 * Team member edit form. Routes:
 *   /team/new        -> create (admin pre-provisioning; uses random uuid PK
 *                       which handle_new_user swaps to the auth uuid on
 *                       first sign-in)
 *   /team/:id/edit   -> edit existing member
 *
 * Admin-only (gated by <AdminRoute>). Sticky save bar at the bottom.
 */
export default function TeamMemberEdit() {
  const { id } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const isCreate = !id;

  const { options: depts, addOption: addDept } = useLookup("departments");

  const [initial, setInitial] = useState<FormState>(EMPTY);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [loading, setLoading] = useState(!isCreate);
  const [saving, setSaving] = useState(false);
  const [confirmLeaveOpen, setConfirmLeaveOpen] = useState(false);
  const [confirmDeactivateOpen, setConfirmDeactivateOpen] = useState(false);
  const [lastActiveAt, setLastActiveAt] = useState<string | null>(null);
  const [accountLinked, setAccountLinked] = useState(false);

  useEffect(() => {
    if (isCreate) return;
    let active = true;
    (async () => {
      const { data, error } = await supabase
        .from("users")
        .select(
          "id, email, full_name, role_title, department_id, permission_role, slack_handle, slack_user_id, active, last_active_at",
        )
        .eq("id", id!)
        .maybeSingle();
      if (!active) return;
      if (error || !data) {
        toast({ title: "User not found", variant: "destructive" });
        navigate("/users", { replace: true });
        return;
      }
      const next: FormState = {
        fullName: data.full_name ?? "",
        email: data.email,
        roleTitle: data.role_title ?? "",
        departmentId: data.department_id,
        tier: (data.permission_role === "pending" ? "standard" : data.permission_role) as PermissionRole,
        slackHandle: data.slack_handle ?? "",
        slackUserId: data.slack_user_id ?? "",
        active: data.active,
      };
      setForm(next);
      setInitial(next);
      setLastActiveAt(data.last_active_at);
      setAccountLinked(data.permission_role !== "pending");
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [id, isCreate, navigate]);

  const dirty = useMemo(
    () => JSON.stringify(form) !== JSON.stringify(initial),
    [form, initial],
  );

  const onCancel = () => {
    if (!dirty) {
      navigate("/users");
      return;
    }
    setConfirmLeaveOpen(true);
  };

  const validate = (): string | null => {
    if (!form.fullName.trim()) return "Full name is required";
    if (!form.email.trim()) return "Email is required";
    if (!/^[^\s@]+@mirrornyc\.com$/i.test(form.email.trim())) {
      return "Email must end in @mirrornyc.com";
    }
    return null;
  };

  const onSave = async () => {
    const err = validate();
    if (err) {
      toast({ title: err, variant: "destructive" });
      return;
    }
    setSaving(true);
    const payload = {
      email: form.email.trim().toLowerCase(),
      full_name: form.fullName.trim(),
      role_title: form.roleTitle.trim() || null,
      department_id: form.departmentId,
      permission_role: form.tier,
      slack_handle: form.slackHandle.trim() || null,
      slack_user_id: form.slackUserId.trim() || null,
      active: form.active,
    };
    if (isCreate) {
      const { data, error } = await supabase
        .from("users")
        .insert(payload)
        .select("id")
        .single();
      setSaving(false);
      if (error) {
        toast({ title: "Save failed", description: error.message, variant: "destructive" });
        return;
      }
      toast({ title: "User added" });
      navigate(`/users/${data.id}/edit`);
    } else {
      const { error } = await supabase.from("users").update(payload).eq("id", id);
      setSaving(false);
      if (error) {
        toast({ title: "Save failed", description: error.message, variant: "destructive" });
        return;
      }
      toast({ title: "Saved" });
      setInitial(form);
    }
  };

  const doDeactivate = async () => {
    if (!id) return;
    const { error } = await supabase.from("users").update({ active: false }).eq("id", id);
    setConfirmDeactivateOpen(false);
    if (error) {
      toast({ title: "Update failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "User deactivated" });
    setForm((f) => ({ ...f, active: false }));
    setInitial((f) => ({ ...f, active: false }));
  };

  if (loading) {
    return <div className="empty"><p>Loading...</p></div>;
  }

  const accountStatusLabel = isCreate
    ? "Not yet signed in"
    : accountLinked
      ? `Linked · last active ${formatLastActive(lastActiveAt).toLowerCase()}`
      : "Pending account link";

  return (
    <div className="stack-4" style={{ paddingBottom: 24 }}>
      <Link
        to="/users"
        className="tlink"
        onClick={(e) => {
          if (dirty) {
            e.preventDefault();
            setConfirmLeaveOpen(true);
          }
        }}
      >
        <IconArrowLeft className="ic" />
        Back to Users
      </Link>

      <div className="pagehead">
        <div className="eyebrow">Admin</div>
        <h1 className="h-page" style={{ marginTop: 4 }}>
          {isCreate ? "New User" : "Edit User"}
        </h1>
      </div>

      <section className="card">
        <div className="card-pad stack-4">
          <div className="block-lbl">
            <span className="label-section">Profile</span>
          </div>
          <div className="g2">
            <div className="field">
              <label className="label-form">Full Name<span className="req">*</span></label>
              <input
                className={`input ${form.fullName ? "input--filled" : ""}`}
                value={form.fullName}
                onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))}
                placeholder="Jane Doe"
              />
            </div>
            <div className="field">
              <label className="label-form">Email<span className="req">*</span></label>
              <input
                className={`input ${form.email ? "input--filled" : ""}`}
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                placeholder="jane@mirrornyc.com"
              />
            </div>
            <div className="field">
              <label className="label-form">Role / Title</label>
              <input
                className={`input ${form.roleTitle ? "input--filled" : ""}`}
                value={form.roleTitle}
                onChange={(e) => setForm((f) => ({ ...f, roleTitle: e.target.value }))}
                placeholder="Producer"
              />
            </div>
            <div className="field">
              <label className="label-form">Department</label>
              <InlineAddSelect
                options={depts}
                value={depts.find((d) => d.id === form.departmentId)?.name ?? null}
                onSelect={(name) => {
                  const match = depts.find((d) => d.name === name);
                  setForm((f) => ({ ...f, departmentId: match?.id ?? null }));
                }}
                onAdd={async (name) => {
                  const added = await addDept(name);
                  if (added) {
                    setForm((f) => ({ ...f, departmentId: added.id }));
                  }
                  return added;
                }}
                placeholder="No department"
                entityLabel="Department"
                exampleName="Production"
              />
            </div>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-pad stack-4">
          <div className="block-lbl">
            <span className="label-section">Access</span>
          </div>
          <div className="g2">
            <div className="field">
              <label className="label-form">Tier</label>
              <select
                className={`input ${form.tier ? "input--filled" : ""}`}
                value={form.tier}
                onChange={(e) => setForm((f) => ({ ...f, tier: e.target.value as PermissionRole }))}
              >
                {TIER_OPTIONS.map((t) => (
                  <option key={t} value={t}>{tierLabel(t)}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label className="label-form">Account Status</label>
              <div className="input" style={{ display: "flex", alignItems: "center", color: "hsl(var(--muted-foreground))" }}>
                {accountStatusLabel}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-pad stack-4">
          <div className="block-lbl">
            <span className="label-section">Slack</span>
          </div>
          <div className="g2">
            <div className="field">
              <label className="label-form">Slack Handle</label>
              <input
                className={`input ${form.slackHandle ? "input--filled" : ""}`}
                value={form.slackHandle}
                onChange={(e) => setForm((f) => ({ ...f, slackHandle: e.target.value }))}
                placeholder="@jane"
              />
            </div>
            <div className="field">
              <label className="label-form">Slack User ID</label>
              <input
                className={`input ${form.slackUserId ? "input--filled" : ""}`}
                value={form.slackUserId}
                onChange={(e) => setForm((f) => ({ ...f, slackUserId: e.target.value }))}
                placeholder="U01234ABCD"
              />
            </div>
          </div>
        </div>
      </section>

      {!isCreate && form.active ? (
        <div className="row between">
          <button
            type="button"
            className="btn btn-tertiary"
            onClick={() => setConfirmDeactivateOpen(true)}
            style={{ color: "hsl(var(--destructive))" }}
          >
            Deactivate
          </button>
        </div>
      ) : null}

      <StickySaveBar
        dirty={dirty}
        saving={saving}
        onCancel={onCancel}
        onSave={onSave}
        saveLabel={isCreate ? "Add team member" : "Save changes"}
      />

      <AlertDialog open={confirmLeaveOpen} onOpenChange={setConfirmLeaveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
            <AlertDialogDescription>
              You have edits that haven't been saved. Leaving will lose them.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Stay</AlertDialogCancel>
            <AlertDialogAction onClick={() => navigate("/users")}>Discard</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmDeactivateOpen} onOpenChange={setConfirmDeactivateOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate {form.fullName || form.email}?</AlertDialogTitle>
            <AlertDialogDescription>
              They won't be able to sign in. The row is preserved; you can
              reactivate later by toggling Active back on from the Team list.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={doDeactivate}>Deactivate</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
