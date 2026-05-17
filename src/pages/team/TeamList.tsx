import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import {
  FilterBar,
  emptyFilterState,
  type FilterFieldDef,
  type FilterState,
} from "@/components/data/FilterBar";
import { applyFilters } from "@/lib/hq/filterStateApply";
import { IconPlus } from "@/components/icons/HQIcons";
import { loadDepartments, loadTeam, type PermissionRole, type TeamMemberRow } from "@/lib/team/queries";
import { formatLastActive } from "@/lib/team/relativeActive";
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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { toast } from "@/hooks/use-toast";

const TIER_FILTER_FIELDS = (departments: { id: string; name: string }[]): FilterFieldDef[] => [
  { key: "active", label: "Active", type: "enum", options: ["True", "False"] },
  { key: "tier", label: "Tier", type: "enum", options: ["Admin", "Standard", "Freelance", "Pending"] },
  {
    key: "department_id",
    label: "Department",
    type: "lookup",
    lookupOptions: departments.map((d) => ({ id: d.id, name: d.name })),
  },
];

const ASSIGNABLE_TIERS: PermissionRole[] = ["admin", "standard", "freelance"];

/**
 * Team list. Admin-only (gated by <AdminRoute> in App.tsx). Lift of the
 * shipped DataTable pattern with inline editing (tier dropdown + active
 * toggle) instead of click-to-detail. Cards view is hidden for v1.
 *
 * Wireframe Surface 12: List view with columns Name / Role / Department /
 * Tier / Account / Last Active / Active. Default filter: Active is True.
 */
export default function TeamList() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<TeamMemberRow[]>([]);
  const [departments, setDepartments] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmActiveOff, setConfirmActiveOff] = useState<TeamMemberRow | null>(null);
  const [filterState, setFilterState] = useState<FilterState>(() => ({
    connector: "AND",
    chips: [{ field: "active", op: "is", value: "True" }],
  }));

  const reload = useCallback(async () => {
    setLoading(true);
    const [teamRows, deps] = await Promise.all([loadTeam(), loadDepartments()]);
    setRows(teamRows);
    setDepartments(deps);
    setLoading(false);
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const filtered = useMemo(
    () =>
      applyFilters(rows, filterState, (row, key) => {
        if (key === "active") return row.active ? "True" : "False";
        if (key === "tier") {
          const map: Record<PermissionRole, string> = {
            admin: "Admin",
            standard: "Standard",
            freelance: "Freelance",
            pending: "Pending",
          };
          return map[row.permission_role];
        }
        if (key === "department_id") return row.department_id;
        const val = (row as unknown as Record<string, unknown>)[key];
        if (val == null) return null;
        return typeof val === "string" ? val : String(val);
      }),
    [rows, filterState],
  );

  const updateTier = async (row: TeamMemberRow, next: PermissionRole) => {
    const { error } = await supabase
      .from("users")
      .update({ permission_role: next })
      .eq("id", row.id);
    if (error) {
      toast({ title: "Update failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: `${row.full_name ?? row.email} is now ${tierLabel(next)}` });
    await reload();
  };

  const toggleActive = async (row: TeamMemberRow) => {
    if (row.active) {
      setConfirmActiveOff(row);
      return;
    }
    const { error } = await supabase
      .from("users")
      .update({ active: true })
      .eq("id", row.id);
    if (error) {
      toast({ title: "Update failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: `${row.full_name ?? row.email} reactivated` });
    await reload();
  };

  const confirmDeactivate = async () => {
    if (!confirmActiveOff) return;
    const { error } = await supabase
      .from("users")
      .update({ active: false })
      .eq("id", confirmActiveOff.id);
    setConfirmActiveOff(null);
    if (error) {
      toast({ title: "Update failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "User deactivated" });
    await reload();
  };

  const pendingCount = rows.filter((r) => r.permission_role === "pending").length;

  return (
    <div className="stack-4">
      <div className="pagehead">
        <div className="row between">
          <div>
            <div className="eyebrow">Admin</div>
            <h1 className="h-page" style={{ marginTop: 4 }}>Users</h1>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => navigate("/users/new")}
          >
            <IconPlus className="ic" />
            Add User
          </button>
        </div>
      </div>

      <div className="row-c wrap" style={{ alignItems: "center" }}>
        <div className="viewswitch">
          <button type="button" className="on" disabled>List</button>
        </div>
        <FilterBar
          state={filterState}
          onChange={setFilterState}
          fields={TIER_FILTER_FIELDS(departments)}
        />
      </div>

      {loading ? (
        <div className="empty"><p>Loading team...</p></div>
      ) : (
        <>
          <div className="tbl-wrap">
            <table className="tbl tbl--flat">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Role / Title</th>
                  <th>Department</th>
                  <th>Tier</th>
                  <th>Account</th>
                  <th>Last Active</th>
                  <th className="c" style={{ width: 80 }}>Active</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr
                    key={r.id}
                    style={{ cursor: "pointer" }}
                    onClick={(e) => {
                      // Don't navigate when the click came from inside an
                      // interactive cell.
                      if ((e.target as HTMLElement).closest("[data-no-nav]")) return;
                      navigate(`/users/${r.id}/edit`);
                    }}
                  >
                    <td className="lead">{r.full_name ?? r.email}</td>
                    <td className="muted">{r.role_title ?? "-"}</td>
                    <td className="muted">{r.department_name ?? "-"}</td>
                    <td data-no-nav>
                      <TierPopover
                        current={r.permission_role}
                        onPick={(t) => updateTier(r, t)}
                      />
                    </td>
                    <td>{accountPill(r.last_active_at)}</td>
                    <td className="muted">{formatLastActive(r.last_active_at)}</td>
                    <td className="c" data-no-nav>
                      <button
                        type="button"
                        className={`toggle ${r.active ? "toggle--on" : ""}`}
                        aria-label={r.active ? "Deactivate" : "Activate"}
                        onClick={() => toggleActive(r)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <span className="cap">
            {filtered.length} {filtered.length === 1 ? "member" : "members"}
            {pendingCount > 0
              ? ` · ${pendingCount} pending an account link (signed in, no tier assigned yet)`
              : ""}
          </span>
        </>
      )}

      <AlertDialog
        open={Boolean(confirmActiveOff)}
        onOpenChange={(open) => !open && setConfirmActiveOff(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Deactivate {confirmActiveOff?.full_name ?? confirmActiveOff?.email}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              They won't be able to sign in. The row is preserved; you can
              reactivate later by toggling Active back on.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeactivate}>
              Deactivate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function tierLabel(t: PermissionRole): string {
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function tierPillClass(t: PermissionRole): string {
  if (t === "admin") return "p-primary";
  if (t === "standard") return "p-muted";
  if (t === "freelance") return "p-warn";
  return "p-warn"; // pending
}

function TierPopover({
  current,
  onPick,
}: {
  current: PermissionRole;
  onPick: (next: PermissionRole) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`pill ${tierPillClass(current)} pill-sm`}
          style={{ cursor: "pointer", border: "none" }}
        >
          {tierLabel(current)}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="p-1"
        style={{ width: 160, background: "hsl(var(--surface-alt))", border: "1px solid hsl(var(--border-strong))" }}
      >
        <div className="stack-1" style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {ASSIGNABLE_TIERS.map((t) => (
            <button
              key={t}
              type="button"
              className="wn"
              style={{ textAlign: "left", padding: "8px 12px" }}
              onClick={() => {
                onPick(t);
                setOpen(false);
              }}
            >
              <span className={`pill ${tierPillClass(t)} pill-sm`}>{tierLabel(t)}</span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function accountPill(lastActiveAt: string | null) {
  // "Linked" means the row is bound to a real Google account that has
  // signed in at least once. handle_new_user stamps last_active_at on
  // auth.users INSERT, and useAuth re-stamps on every session resolve
  // (Phase 5.6.5.1 follow-on), so it's the authoritative signal.
  // permission_role is unreliable as a proxy — admins pre-provision
  // users with a non-pending tier directly in the create form.
  if (lastActiveAt === null) {
    return (
      <span className="pill p-warn pill-sm">
        <span className="dt"></span>
        Pending
      </span>
    );
  }
  return (
    <span className="pill p-success pill-sm">
      <span className="dt"></span>
      Linked
    </span>
  );
}
