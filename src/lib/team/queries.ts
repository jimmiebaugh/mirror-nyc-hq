import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type PermissionRole = Database["public"]["Enums"]["permission_role"];

export type TeamMemberRow = {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  permission_role: PermissionRole;
  role_title: string | null;
  department_id: string | null;
  department_name: string | null;
  slack_handle: string | null;
  slack_user_id: string | null;
  active: boolean;
  last_active_at: string | null;
};

export type DepartmentRow = {
  id: string;
  name: string;
};

export async function loadTeam(): Promise<TeamMemberRow[]> {
  const { data, error } = await supabase
    .from("users")
    .select(
      "id, email, full_name, avatar_url, permission_role, role_title, department_id, slack_handle, slack_user_id, active, last_active_at, department:departments!users_department_id_fkey(name)",
    )
    .order("full_name", { ascending: true });
  if (error) {
    console.warn("loadTeam error", error);
    return [];
  }
  type Row = Omit<TeamMemberRow, "department_name"> & {
    department: { name: string | null } | null;
  };
  return ((data ?? []) as unknown as Row[]).map((u) => ({
    id: u.id,
    email: u.email,
    full_name: u.full_name,
    avatar_url: u.avatar_url,
    permission_role: u.permission_role,
    role_title: u.role_title,
    department_id: u.department_id,
    department_name: u.department?.name ?? null,
    slack_handle: u.slack_handle,
    slack_user_id: u.slack_user_id,
    active: u.active,
    last_active_at: u.last_active_at,
  }));
}

export async function loadDepartments(): Promise<DepartmentRow[]> {
  const { data, error } = await supabase
    .from("departments")
    .select("id, name")
    .order("name", { ascending: true });
  if (error) {
    console.warn("loadDepartments error", error);
    return [];
  }
  return (data ?? []) as DepartmentRow[];
}
