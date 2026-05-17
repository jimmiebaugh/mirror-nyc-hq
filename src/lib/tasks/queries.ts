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
  project: { id: string; name: string; client: { id: string; name: string | null } | null } | null;
  assignee: { id: string; full_name: string | null; email: string | null } | null;
};

export async function loadTasks(): Promise<TaskListRow[]> {
  const { data, error } = await supabase
    .from("tasks")
    .select(
      // Constraint-named FKs throughout so PostgREST returns the embed as
      // an object (not an array). Without this, nested embeds like
      // client.name silently come back undefined on some configs.
      `id, title, description, status, priority, due_date, blocked_by,
       project:projects!tasks_project_id_fkey(id, name, client:clients!projects_client_id_fkey(id, name)),
       assignee:users!tasks_assignee_id_fkey(id, full_name, email)`,
    )
    .order("due_date", { ascending: true, nullsFirst: false });
  if (error) {
    console.warn("loadTasks error", error);
    return [];
  }
  // Normalize the nested `project.client` shape: PostgREST sometimes
  // returns the embed as `Client | Client[] | null`. Collapse to object.
  return (data ?? []).map((rawRow) => {
    const row = rawRow as unknown as Omit<TaskListRow, "project"> & {
      project:
        | {
            id: string;
            name: string;
            client:
              | { id: string; name: string | null }
              | { id: string; name: string | null }[]
              | null;
          }
        | {
            id: string;
            name: string;
            client:
              | { id: string; name: string | null }
              | { id: string; name: string | null }[]
              | null;
          }[]
        | null;
    };
    const project = Array.isArray(row.project) ? row.project[0] : row.project;
    const client = project
      ? Array.isArray(project.client)
        ? (project.client[0] ?? null)
        : (project.client ?? null)
      : null;
    return {
      ...row,
      project: project
        ? { id: project.id, name: project.name, client }
        : null,
    } as TaskListRow;
  });
}

export async function updateTaskStatus(id: string, status: TaskStatus) {
  const { error } = await supabase.from("tasks").update({ status }).eq("id", id);
  if (error) throw error;
}

export async function updateTaskPriority(id: string, priority: TaskPriority) {
  const { error } = await supabase.from("tasks").update({ priority }).eq("id", id);
  if (error) throw error;
}
