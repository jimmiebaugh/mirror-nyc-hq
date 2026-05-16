import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

type TeamRow = {
  id: string;
  full_name: string | null;
  email: string;
  role_title: string | null;
  department_name: string | null;
};

/**
 * Read-only team directory embedded into the Wiki "Team Directory" page.
 * Surfaces active team members grouped by department. Wireframe Surface 17
 * shows this as a flat embed table; we render one .tbl per department for
 * readability.
 */
export function TeamDirectoryEmbed() {
  const [rows, setRows] = useState<TeamRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data, error } = await supabase
        .from("users")
        .select(
          "id, full_name, email, role_title, department:departments!users_department_id_fkey(name)",
        )
        .eq("active", true)
        .neq("permission_role", "pending")
        .order("full_name", { ascending: true });
      if (!active) return;
      if (error) {
        console.warn("TeamDirectoryEmbed load failed", error);
        setRows([]);
      } else {
        type Row = {
          id: string;
          full_name: string | null;
          email: string;
          role_title: string | null;
          department: { name: string | null } | null;
        };
        setRows(
          ((data ?? []) as unknown as Row[]).map((u) => ({
            id: u.id,
            full_name: u.full_name,
            email: u.email,
            role_title: u.role_title,
            department_name: u.department?.name ?? null,
          })),
        );
      }
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  if (loading) {
    return (
      <p className="cap" style={{ textAlign: "center", padding: "48px 0" }}>
        Loading team directory...
      </p>
    );
  }

  if (rows.length === 0) {
    return (
      <p className="cap" style={{ textAlign: "center", padding: "48px 0" }}>
        No active team members yet.
      </p>
    );
  }

  // Group by department name (nulls bucket under "Unassigned").
  const groups = new Map<string, TeamRow[]>();
  for (const r of rows) {
    const key = r.department_name ?? "Unassigned";
    const list = groups.get(key) ?? [];
    list.push(r);
    groups.set(key, list);
  }
  const sortedDepts = [...groups.keys()].sort((a, b) => {
    if (a === "Unassigned") return 1;
    if (b === "Unassigned") return -1;
    return a.localeCompare(b);
  });

  return (
    <div className="stack-4">
      {sortedDepts.map((dept) => (
        <div key={dept}>
          <div className="block-lbl">
            <span className="label-section">{dept}</span>
          </div>
          <div className="tbl-wrap">
            <table className="tbl">
              <tbody>
                {(groups.get(dept) ?? []).map((u) => (
                  <tr key={u.id}>
                    <td className="lead" style={{ width: 240 }}>
                      {u.full_name ?? u.email}
                    </td>
                    <td className="muted">{u.role_title ?? "-"}</td>
                    <td className="muted">
                      <a
                        className="tlink"
                        href={`mailto:${u.email}`}
                        style={{ color: "hsl(var(--muted-foreground))" }}
                      >
                        {u.email}
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}
