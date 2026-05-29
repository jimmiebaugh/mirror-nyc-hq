import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { IconPlus, IconX } from "@/components/icons/HQIcons";
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
import { loadTeam, type TeamMemberRow } from "@/lib/team/queries";
import { formatLastActive } from "@/lib/team/relativeActive";

/**
 * Settings Admins card. Lists active admins; "+ Add Admin" picker promotes
 * a Standard user; X icon demotes back to Standard with confirmation.
 */
export function AdminsCard() {
  const [members, setMembers] = useState<TeamMemberRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<TeamMemberRow | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    const all = await loadTeam();
    setMembers(all);
    setLoading(false);
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const admins = members.filter((m) => m.permission_role === "admin" && m.active);
  const promotable = members.filter(
    (m) => m.permission_role !== "admin" && m.permission_role !== "pending" && m.active,
  );

  const promote = async (m: TeamMemberRow) => {
    const { error } = await supabase
      .from("users")
      .update({ permission_role: "admin" })
      .eq("id", m.id);
    setPickerOpen(false);
    if (error) {
      toast({ title: "Promote failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: `${m.full_name ?? m.email} is now an Admin` });
    await reload();
  };

  const demote = async () => {
    if (!confirmRemove) return;
    const { error } = await supabase
      .from("users")
      .update({ permission_role: "standard" })
      .eq("id", confirmRemove.id);
    setConfirmRemove(null);
    if (error) {
      toast({ title: "Demote failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: `${confirmRemove.full_name ?? confirmRemove.email} moved to Standard` });
    await reload();
  };

  return (
    <div className="card">
      <div className="card-headbar">
        <span className="h-card">Admins</span>
        <button
          type="button"
          className="tlink"
          onClick={() => setPickerOpen(true)}
          style={{ background: "none", border: "none" }}
        >
          <IconPlus className="ic ic-sm" />
          Add Admin
        </button>
      </div>
      {loading ? (
        <div className="card-pad"><p className="cap">Loading...</p></div>
      ) : (
        <div className="tbl-wrap">
          <table className="tbl tbl--flat">
            <thead>
              <tr>
                <th className="l">Name</th>
                <th className="l">Role / Title</th>
                <th className="l">Department</th>
                <th className="l">Last Active</th>
                <th className="r" style={{ width: 40 }}></th>
              </tr>
            </thead>
            <tbody>
              {admins.map((a) => (
                <tr key={a.id}>
                  <td className="lead">{a.full_name ?? a.email}</td>
                  <td className="muted">{a.role_title ?? "-"}</td>
                  <td className="muted">{a.department_name ?? "-"}</td>
                  <td className="muted">{formatLastActive(a.last_active_at)}</td>
                  <td className="r">
                    <button
                      type="button"
                      className="ca"
                      onClick={() => setConfirmRemove(a)}
                      title="Remove from Admins"
                      aria-label="Remove from Admins"
                    >
                      <IconX className="ic ic-sm" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Promote to Admin</DialogTitle>
          </DialogHeader>
          {promotable.length === 0 ? (
            <p className="cap">No promotable users. Add a Standard team member first.</p>
          ) : (
            <div className="stack-1" style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 360, overflowY: "auto" }}>
              {promotable.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className="row-c between"
                  style={{
                    padding: "10px 12px",
                    background: "hsl(var(--surface-alt))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "var(--radius)",
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                  onClick={() => promote(m)}
                >
                  <div>
                    <div className="lead" style={{ fontSize: 13 }}>{m.full_name ?? m.email}</div>
                    <div className="cap">{m.role_title ?? m.email}</div>
                  </div>
                  <span className="cap">{m.permission_role}</span>
                </button>
              ))}
            </div>
          )}
          <DialogFooter>
            <button type="button" className="btn btn-tertiary" onClick={() => setPickerOpen(false)}>
              Cancel
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(confirmRemove)} onOpenChange={(open) => !open && setConfirmRemove(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Remove {confirmRemove?.full_name ?? confirmRemove?.email} from Admins?
            </AlertDialogTitle>
            <AlertDialogDescription>
              They will be set to Standard. You can promote them back from this card at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={demote}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
