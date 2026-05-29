import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useLookup } from "@/lib/hq/lookups";
import { RecordCombobox } from "@/components/ui/RecordCombobox";
import { StickySaveBar } from "@/components/data/StickySaveBar";
import { IconArrowLeft } from "@/components/icons/HQIcons";
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

/**
 * Self-only profile settings route at `/settings/profile`.
 *
 * Phase 5.7.12: Standard + Freelance can edit their own role_title,
 * department, slack_handle, slack_user_id. Admins use this too (it's
 * lower-friction than /users/:id/edit for self-edits). Tier columns
 * (permission_role, is_owner, active), email, and full_name stay
 * admin-only via the extended `users_protect_admin_columns` trigger.
 * Avatar shown read-only ("comes from your Google account"); upload
 * deferred to 5.7.14 Leftovers per spec § 4.
 */

type FormState = {
  fullName: string;
  roleTitle: string;
  departmentId: string | null;
  slackHandle: string;
  slackUserId: string;
};

const EMPTY: FormState = {
  fullName: "",
  roleTitle: "",
  departmentId: null,
  slackHandle: "",
  slackUserId: "",
};

function initialsFor(name?: string | null, email?: string | null): string {
  const base = (name || email || "??").trim();
  const parts = base.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return base.slice(0, 2).toUpperCase();
}

export default function ProfileSettings() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const viewerId = user?.id ?? null;
  const { options: depts } = useLookup("departments");

  const [email, setEmail] = useState<string>("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [initial, setInitial] = useState<FormState>(EMPTY);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [missingRow, setMissingRow] = useState(false);
  const [confirmLeaveOpen, setConfirmLeaveOpen] = useState(false);

  useEffect(() => {
    if (!viewerId) return;
    let active = true;
    setLoading(true);
    (async () => {
      const { data, error } = await supabase
        .from("users")
        .select(
          "id, full_name, email, avatar_url, role_title, department_id, slack_handle, slack_user_id",
        )
        .eq("id", viewerId)
        .maybeSingle();
      if (!active) return;
      if (error || !data) {
        setMissingRow(true);
        setLoading(false);
        return;
      }
      setEmail(data.email);
      setAvatarUrl(data.avatar_url ?? null);
      const next: FormState = {
        fullName: data.full_name ?? "",
        roleTitle: data.role_title ?? "",
        departmentId: data.department_id,
        // Strip a leading @ if it's already stored that way so the
        // prefixed-input renders the bare handle.
        slackHandle: (data.slack_handle ?? "").replace(/^@+/, ""),
        slackUserId: data.slack_user_id ?? "",
      };
      setInitial(next);
      setForm(next);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [viewerId]);

  const dirty = useMemo(
    () => JSON.stringify(form) !== JSON.stringify(initial),
    [form, initial],
  );

  const onCancel = () => {
    if (!dirty) {
      navigate(viewerId ? `/users/${viewerId}` : "/");
      return;
    }
    setConfirmLeaveOpen(true);
  };

  const onSave = async () => {
    if (!viewerId) return;
    const trimmedName = form.fullName.trim();
    if (!trimmedName) {
      toast({ title: "Full name is required", variant: "destructive" });
      return;
    }
    setSaving(true);
    // Defensive trim in case anyone pasted a leading @ even though the
    // input renders one as static prefix.
    const handle = form.slackHandle.trim().replace(/^@+/, "");
    const payload = {
      full_name: trimmedName,
      role_title: form.roleTitle.trim() || null,
      department_id: form.departmentId,
      slack_handle: handle || null,
      slack_user_id: form.slackUserId.trim() || null,
    };
    const { error } = await supabase.from("users").update(payload).eq("id", viewerId);
    setSaving(false);
    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Profile updated." });
    const normalized: FormState = {
      fullName: payload.full_name,
      roleTitle: payload.role_title ?? "",
      departmentId: payload.department_id,
      slackHandle: payload.slack_handle ?? "",
      slackUserId: payload.slack_user_id ?? "",
    };
    setInitial(normalized);
    setForm(normalized);
  };

  if (loading) {
    return (
      <div className="empty">
        <p>Loading...</p>
      </div>
    );
  }
  if (missingRow) {
    return (
      <div className="stack-4">
        <Link to="/" className="tlink">
          <IconArrowLeft className="ic" /> Back to Home
        </Link>
        <div className="empty">
          <p style={{ color: "hsl(var(--foreground))", fontWeight: 500 }}>
            We can't find your profile.
          </p>
          <p style={{ marginTop: 4 }}>
            Contact an admin to get your account linked.
          </p>
        </div>
      </div>
    );
  }

  const initials = initialsFor(form.fullName, email);

  return (
    <div className="stack-4 hq-form" style={{ paddingBottom: 120 }}>
      <div className="pagehead">
        <div className="eyebrow">Settings</div>
        <h1 className="h-page" style={{ marginTop: 4 }}>Your profile</h1>
      </div>

      <section className="card">
        <div className="card-headbar">
          <span className="h-card">Identity</span>
        </div>
        <div className="card-pad stack-4">
          <div className="row-c" style={{ alignItems: "flex-start", gap: 16 }}>
            <span
              aria-label={initials}
              style={{
                width: 80,
                height: 80,
                borderRadius: 9999,
                background: "hsl(var(--surface-raised))",
                border: "1px solid hsl(var(--border-strong))",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                overflow: "hidden",
                fontFamily: "var(--font-mono)",
                fontSize: 22,
                fontWeight: 700,
                flex: "none",
              }}
            >
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt={initials}
                  referrerPolicy="no-referrer"
                  style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                />
              ) : (
                initials
              )}
            </span>
            <div className="cap" style={{ flex: 1 }}>
              Your avatar comes from your Google account. Photo upload is coming
              in a future update.
            </div>
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
              <label className="label-form">Email</label>
              <input
                className={`input ${email ? "input--filled" : ""}`}
                value={email}
                readOnly
                disabled
              />
            </div>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-headbar">
          <span className="h-card">Role &amp; Team</span>
        </div>
        <div className="card-pad stack-4">
          <div className="g2">
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
              <RecordCombobox
                source={{ kind: "lookup", table: "departments" }}
                value={depts.find((d) => d.id === form.departmentId)?.name ?? null}
                onChange={(name) => {
                  const match = depts.find((d) => d.name === name);
                  setForm((f) => ({ ...f, departmentId: match?.id ?? null }));
                }}
                placeholder="No department"
                entityLabel="Department"
                allowCreate={false}
              />
            </div>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-headbar">
          <span className="h-card">Slack</span>
        </div>
        <div className="card-pad stack-4">
          <div className="g2">
            <div className="field">
              <label className="label-form">Slack Handle</label>
              <span
                className="cap"
                style={{ marginTop: 2, marginBottom: 6, color: "hsl(var(--subtle-foreground))", fontSize: 11 }}
              >
                In Slack: click your avatar &rarr; Profile &rarr; your @ appears under your name.
              </span>
              <div style={{ position: "relative" }}>
                <span
                  aria-hidden="true"
                  style={{
                    position: "absolute",
                    left: 12,
                    top: "50%",
                    transform: "translateY(-50%)",
                    color: "hsl(var(--subtle-foreground))",
                    fontSize: 13,
                    pointerEvents: "none",
                  }}
                >
                  @
                </span>
                <input
                  className={`input ${form.slackHandle ? "input--filled" : ""}`}
                  value={form.slackHandle}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, slackHandle: e.target.value.replace(/^@+/, "") }))
                  }
                  placeholder="jane"
                  style={{ paddingLeft: 24 }}
                />
              </div>
            </div>
            <div className="field">
              <label className="label-form">Slack User ID</label>
              <span
                className="cap"
                style={{ marginTop: 2, marginBottom: 6, color: "hsl(var(--subtle-foreground))", fontSize: 11 }}
              >
                Find this in Slack: click your avatar &rarr; Profile &rarr; More &rarr; Copy member ID.
              </span>
              <input
                className={`input ${form.slackUserId ? "input--filled" : ""}`}
                value={form.slackUserId}
                onChange={(e) => setForm((f) => ({ ...f, slackUserId: e.target.value }))}
                placeholder="U01234ABCD"
              />
            </div>
          </div>
          <div>
            <Link to="/notifications/preferences" className="tlink">
              Notification preferences &rarr;
            </Link>
          </div>
        </div>
      </section>

      <StickySaveBar
        dirty={dirty}
        saving={saving}
        onCancel={onCancel}
        onSave={onSave}
        saveLabel="Save changes"
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
            <AlertDialogAction
              onClick={() => navigate(viewerId ? `/users/${viewerId}` : "/")}
            >
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
