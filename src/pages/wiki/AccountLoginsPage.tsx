import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useIdleTimer } from "@/hooks/useIdleTimer";
import { CredentialRevealField } from "@/components/wiki/CredentialRevealField";
import { IconPencil, IconPlus, IconX } from "@/components/icons/HQIcons";
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
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";

type Credential = {
  id: string;
  service_name: string;
  username: string | null;
  password: string;
  url: string | null;
  updated_at: string;
};

const IDLE_DELAY_MS = 30_000;

/**
 * Account Logins page renders inside the Wiki shell (the wiki_pages row
 * with slug = 'account-logins' has page_type = 'account_logins', which
 * causes WikiPage to render this component instead of prose).
 *
 * Auth: Freelance users are blocked at WikiPage (visibility = no_freelance
 * also hides from nav; component check shows access-restricted state).
 * RLS on credentials enforces non-freelance-only SELECT + INSERT/UPDATE/DELETE
 * (widened in 5.4 feedback round 2 from admin-only).
 *
 * `canWrite` toggles the Add Credential button + per-row Edit/Delete icons.
 * Always true under the current call site (WikiPage passes canWrite when
 * the user is non-freelance, which the freelance gate above already enforces).
 *
 * Reveal-and-copy pattern: each row's password starts masked. Eye toggle
 * reveals just that row. A single 30-second idle timer re-masks ALL rows
 * on fire. Any user interaction resets the timer.
 */
export function AccountLoginsPage({ canWrite }: { canWrite: boolean }) {
  const { user } = useAuth();
  const [rows, setRows] = useState<Credential[]>([]);
  const [loading, setLoading] = useState(true);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<Credential | "new" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Credential | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("credentials")
      .select("*")
      .order("service_name", { ascending: true });
    if (error) {
      console.warn("AccountLoginsPage load failed", error);
      setRows([]);
    } else {
      setRows((data ?? []) as Credential[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Auto-redact on idle, active only when at least one row is revealed.
  useIdleTimer({
    delayMs: IDLE_DELAY_MS,
    active: revealed.size > 0,
    onIdle: () => setRevealed(new Set()),
  });

  const toggleReveal = (id: string) => {
    setRevealed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const formatUpdated = (iso: string) =>
    new Date(iso).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });

  const onDelete = async () => {
    if (!confirmDelete) return;
    const { error } = await supabase
      .from("credentials")
      .delete()
      .eq("id", confirmDelete.id);
    setConfirmDelete(null);
    if (error) {
      toast({ title: "Delete failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Credential deleted" });
    setRevealed((prev) => {
      const next = new Set(prev);
      next.delete(confirmDelete.id);
      return next;
    });
    await load();
  };

  return (
    <div className="stack-4">
      <div className="row between" style={{ marginBottom: 8 }}>
        <span />
        {canWrite ? (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setEditing("new")}
          >
            <IconPlus className="ic" />
            Add Credential
          </button>
        ) : null}
      </div>
      {loading ? (
        <p className="cap" style={{ textAlign: "center", padding: "48px 0" }}>
          Loading credentials...
        </p>
      ) : rows.length === 0 ? (
        <div className="empty">
          <p>No credentials saved yet.</p>
          {canWrite ? (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              style={{ marginTop: 16 }}
              onClick={() => setEditing("new")}
            >
              <IconPlus className="ic" />
              Add Credential
            </button>
          ) : null}
        </div>
      ) : (
        <>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Service</th>
                  <th>Username</th>
                  <th>Password</th>
                  <th className="r" style={{ width: 130 }}>Updated</th>
                  {canWrite ? <th className="r" style={{ width: 60 }}></th> : null}
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id}>
                    <td className="lead" style={{ width: 160 }}>{c.service_name}</td>
                    <td>
                      {c.username ? (
                        <CredentialRevealField
                          value={c.username}
                          masked={false}
                          maskable={false}
                        />
                      ) : (
                        <span className="muted subtle">-</span>
                      )}
                    </td>
                    <td>
                      <CredentialRevealField
                        value={c.password}
                        masked={!revealed.has(c.id)}
                        onToggleMask={() => toggleReveal(c.id)}
                      />
                    </td>
                    <td className="r muted">{formatUpdated(c.updated_at)}</td>
                    {canWrite ? (
                      <td className="r">
                        <button
                          type="button"
                          className="ca"
                          onClick={() => setEditing(c)}
                          title="Edit"
                          aria-label="Edit credential"
                          style={{ marginRight: 6 }}
                        >
                          <IconPencil className="ic ic-sm" />
                        </button>
                        <button
                          type="button"
                          className="ca"
                          onClick={() => setConfirmDelete(c)}
                          title="Delete"
                          aria-label="Delete credential"
                        >
                          <IconX className="ic ic-sm" />
                        </button>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="cap">
            {rows.length} credential{rows.length === 1 ? "" : "s"}
          </p>
        </>
      )}

      {editing ? (
        <CredentialEditDialog
          mode={editing === "new" ? "create" : "edit"}
          initial={editing === "new" ? null : editing}
          userId={user?.id ?? null}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
          }}
        />
      ) : null}

      <AlertDialog
        open={Boolean(confirmDelete)}
        onOpenChange={(open) => !open && setConfirmDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this credential?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDelete?.service_name} will be permanently removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={onDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function CredentialEditDialog({
  mode,
  initial,
  userId,
  onClose,
  onSaved,
}: {
  mode: "create" | "edit";
  initial: Credential | null;
  userId: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [serviceName, setServiceName] = useState(initial?.service_name ?? "");
  const [username, setUsername] = useState(initial?.username ?? "");
  const [password, setPassword] = useState(initial?.password ?? "");
  const [url, setUrl] = useState(initial?.url ?? "");
  const [saving, setSaving] = useState(false);

  const dirty = useMemo(() => {
    if (mode === "create")
      return serviceName.trim() !== "" || password.trim() !== "";
    return (
      serviceName !== (initial?.service_name ?? "") ||
      username !== (initial?.username ?? "") ||
      password !== (initial?.password ?? "") ||
      url !== (initial?.url ?? "")
    );
  }, [mode, initial, serviceName, username, password, url]);

  const onSave = async () => {
    if (!serviceName.trim()) {
      toast({ title: "Service name is required", variant: "destructive" });
      return;
    }
    if (!password.trim()) {
      toast({ title: "Password is required", variant: "destructive" });
      return;
    }
    setSaving(true);
    const payload = {
      service_name: serviceName.trim(),
      username: username.trim() || null,
      password,
      url: url.trim() || null,
      updated_by: userId,
    };
    const op = mode === "create"
      ? supabase
          .from("credentials")
          .insert({ ...payload, created_by: userId ?? "" })
      : supabase.from("credentials").update(payload).eq("id", initial!.id);
    const { error } = await op;
    setSaving(false);
    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: mode === "create" ? "Credential added" : "Credential updated" });
    onSaved();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "Add Credential" : "Edit Credential"}</DialogTitle>
        </DialogHeader>
        <div className="stack-3">
          <div className="field">
            <label className="label-form">Service<span className="req">*</span></label>
            <input
              className={`input ${serviceName ? "input--filled" : ""}`}
              value={serviceName}
              onChange={(e) => setServiceName(e.target.value)}
              placeholder="FedEx"
            />
          </div>
          <div className="field">
            <label className="label-form">Username</label>
            <input
              className={`input ${username ? "input--filled" : ""}`}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="mirrornyc-ship"
            />
          </div>
          <div className="field">
            <label className="label-form">Password<span className="req">*</span></label>
            <input
              className={`input ${password ? "input--filled" : ""}`}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </div>
          <div className="field">
            <label className="label-form">URL</label>
            <input
              className={`input ${url ? "input--filled" : ""}`}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://fedex.com"
            />
          </div>
        </div>
        <DialogFooter>
          <button type="button" className="btn btn-tertiary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!dirty || saving}
            onClick={onSave}
          >
            {saving ? "Saving..." : mode === "create" ? "Add" : "Save"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
