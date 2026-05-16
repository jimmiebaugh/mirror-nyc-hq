import { supabase } from "@/integrations/supabase/client";

export type TaskStatus = "To Do" | "Doing" | "Blocked" | "Done";
export type TaskPriority = "Urgent" | "High" | "Normal" | "Low";

export const TASK_STATUS_VALUES: TaskStatus[] = ["To Do", "Doing", "Blocked", "Done"];
export const TASK_PRIORITY_VALUES: TaskPriority[] = ["Urgent", "High", "Normal", "Low"];

export type TaskListRow = {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  due_date: string | null;
  blocked_by: string[];
  project: { id: string; name: string; organization: { id: string; name: string | null } | null } | null;
  assignee: { id: string; full_name: string | null; email: string | null } | null;
};

export async function loadTasks(): Promise<TaskListRow[]> {
  const { data, error } = await supabase
    .from("tasks")
    .select(
      `id, title, description, status, priority, due_date, blocked_by,
       project:projects(id, name, organization:organizations(id, name)),
       assignee:users!tasks_assignee_id_fkey(id, full_name, email)`,
    )
    .order("due_date", { ascending: true, nullsFirst: false });
  if (error) {
    console.warn("loadTasks error", error);
    return [];
  }
  return (data ?? []) as unknown as TaskListRow[];
}

export async function updateTaskStatus(id: string, status: TaskStatus) {
  const { error } = await supabase.from("tasks").update({ status }).eq("id", id);
  if (error) throw error;
}
