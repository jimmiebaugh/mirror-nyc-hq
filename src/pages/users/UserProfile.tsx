import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useUserRole } from "@/hooks/useUserRole";
import { IconArrowLeft, IconSlack } from "@/components/icons/HQIcons";
import { LoadError } from "@/components/ui/LoadError";
import { formatLastActive } from "@/lib/team/relativeActive";
import type { PermissionRole } from "@/lib/team/queries";

/**
 * Read-only Profile route at `/users/:id`.
 *
 * Phase 5.7.12: every authenticated user can view this surface so the
 * @-mention spans (InternalNotesEditor, ActivityFeed, RecentActivityCard)
 * have a real destination. The page is fully read-only; the edit
 * affordance routes admins to `/users/:id/edit` (TeamMemberEdit) and the
 * viewer's own row to `/settings/profile`.
 *
 * No Activity card today (spec § 6.A carry-forward). No InternalNotes
 * (parentType union doesn't include 'user').
 */

type ProfileRow = {
  id: string;
  full_name: string | null;
  email: string;
  avatar_url: string | null;
  permission_role: PermissionRole;
  role_title: string | null;
  slack_handle: string | null;
  slack_user_id: string | null;
  last_active_at: string | null;
  active: boolean;
  is_owner: boolean;
  created_at: string;
  department: { id: string; name: string } | null;
};

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function memberSince(iso: string): string {
  const d = new Date(iso);
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

function initialsFor(name?: string | null, email?: string | null): string {
  const base = (name || email || "??").trim();
  const parts = base.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return base.slice(0, 2).toUpperCase();
}

function tierPillClass(t: PermissionRole): string {
  if (t === "admin") return "p-primary";
  if (t === "standard") return "p-muted";
  if (t === "freelance") return "p-warn";
  return "p-warn";
}

function tierLabel(t: PermissionRole): string {
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export default function UserProfile() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { isAdmin, loading: roleLoading } = useUserRole();
  const [row, setRow] = useState<ProfileRow | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "not_found">("loading");

  useEffect(() => {
    if (!id) return;
    let active = true;
    setStatus("loading");
    (async () => {
      const { data, error } = await supabase
        .from("users")
        .select(
          "id, full_name, email, avatar_url, permission_role, role_title, slack_handle, slack_user_id, last_active_at, active, is_owner, created_at, department:departments!users_department_id_fkey(id, name)",
        )
        .eq("id", id)
        .maybeSingle();
      if (!active) return;
      if (error || !data) {
        setStatus("not_found");
        return;
      }
      setRow(data as unknown as ProfileRow);
      setStatus("ready");
    })();
    return () => {
      active = false;
    };
  }, [id]);

  // Back-link target. /users (TeamList) is admin-only; non-admins fall back to /.
  const backHref = isAdmin ? "/users" : "/";
  const backLabel = isAdmin ? "Users" : "Home";

  if (status === "loading" || roleLoading) {
    return (
      <div className="empty">
        <p>Loading...</p>
      </div>
    );
  }
  if (status === "not_found" || !row) {
    return (
      <div className="stack-4">
        <Link to={backHref} className="tlink">
          <IconArrowLeft className="ic" /> Back to {backLabel}
        </Link>
        <LoadError
          title="User not found"
          description="This profile doesn't exist or you don't have permission to view it."
        />
      </div>
    );
  }

  const viewerId = user?.id ?? null;
  const isSelf = viewerId === row.id;
  const subtitle = `${row.role_title || "—"} · ${row.department?.name || "No department"}`;
  const initials = initialsFor(row.full_name, row.email);

  return (
    <div className="stack-4">
      <Link to={backHref} className="tlink">
        <IconArrowLeft className="ic" /> Back to {backLabel}
      </Link>

      <div className="row between" style={{ alignItems: "flex-start", gap: 16 }}>
        <div className="row-c" style={{ alignItems: "flex-start", gap: 14, flex: 1, minWidth: 0 }}>
          <span
            aria-label={initials}
            style={{
              width: 40,
              height: 40,
              borderRadius: 9999,
              background: "hsl(var(--surface-raised))",
              border: "1px solid hsl(var(--border-strong))",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              overflow: "hidden",
              fontFamily: "var(--font-mono)",
              fontSize: 13,
              fontWeight: 700,
              flex: "none",
            }}
          >
            {row.avatar_url ? (
              <img
                src={row.avatar_url}
                alt={initials}
                referrerPolicy="no-referrer"
                style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
              />
            ) : (
              initials
            )}
          </span>
          <div style={{ minWidth: 0 }}>
            <div className="eyebrow">User</div>
            <h1 className="h-page" style={{ marginTop: 4 }}>
              {row.full_name || row.email}
            </h1>
            <div
              style={{
                marginTop: 6,
                fontSize: 14,
                color: "hsl(var(--muted-foreground))",
              }}
            >
              {subtitle}
            </div>
          </div>
        </div>
        {isSelf ? (
          <Link to="/settings/profile" className="btn btn-secondary">
            Edit your profile
          </Link>
        ) : isAdmin ? (
          <Link to={`/users/${row.id}/edit`} className="btn btn-secondary">
            Manage user
          </Link>
        ) : null}
      </div>

      <section className="card">
        <div className="card-headbar">
          <span className="h-card">Role &amp; Team</span>
        </div>
        <div className="card-pad">
          <dl className="kv">
            <dt>Role</dt>
            <dd>{row.role_title || <span className="muted subtle">—</span>}</dd>
            <dt>Department</dt>
            <dd>{row.department?.name || <span className="muted subtle">—</span>}</dd>
            <dt>Tier</dt>
            <dd>
              <span className={`pill ${tierPillClass(row.permission_role)} pill-sm`}>
                {tierLabel(row.permission_role)}
              </span>
            </dd>
            {row.is_owner ? (
              <>
                <dt>Owner</dt>
                <dd>
                  <span className="pill p-info pill-sm">Owner</span>
                </dd>
              </>
            ) : null}
          </dl>
        </div>
      </section>

      <section className="card">
        <div className="card-headbar">
          <span className="h-card">Contact</span>
        </div>
        <div className="card-pad">
          <dl className="kv">
            <dt>Email</dt>
            <dd>
              <a
                className="tlink inline-block max-w-full truncate align-bottom"
                href={`mailto:${row.email}`}
              >
                {row.email}
              </a>
            </dd>
            <dt>Slack</dt>
            <dd className="row-c" style={{ gap: 6 }}>
              <IconSlack className="ic ic-sm" />
              {row.slack_user_id ? (
                <span>Connected</span>
              ) : (
                <span className="muted subtle">Not connected</span>
              )}
            </dd>
            <dt>Slack handle</dt>
            <dd>
              {row.slack_handle ? (
                <span>@{row.slack_handle.replace(/^@/, "")}</span>
              ) : (
                <span className="muted subtle">—</span>
              )}
            </dd>
          </dl>
        </div>
      </section>

      <section className="card">
        <div className="card-headbar">
          <span className="h-card">Status</span>
        </div>
        <div className="card-pad">
          <dl className="kv">
            <dt>Active</dt>
            <dd>
              {row.active ? (
                <span className="pill p-success pill-sm">
                  <span className="dt"></span>
                  Active
                </span>
              ) : (
                <span className="pill p-muted pill-sm">
                  <span className="dt"></span>
                  Deactivated
                </span>
              )}
            </dd>
            <dt>Last active</dt>
            <dd>{formatLastActive(row.last_active_at)}</dd>
            <dt>Member since</dt>
            <dd>{memberSince(row.created_at)}</dd>
          </dl>
        </div>
      </section>
    </div>
  );
}
