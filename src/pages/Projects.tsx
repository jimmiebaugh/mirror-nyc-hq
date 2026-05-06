import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface ProjectRow {
  id: string;
  name?: string | null;
  client?: string | null;
  status?: string | null;
  start_date?: string | null;
  end_date?: string | null;
}

function formatDate(d?: string | null) {
  if (!d) return "—";
  const date = new Date(d);
  if (isNaN(date.getTime())) return d;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function Projects() {
  const [rows, setRows] = useState<ProjectRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      // The projects table may not exist yet — query untyped and handle gracefully.
      const { data, error } = await (supabase as unknown as {
        from: (t: string) => { select: (q: string) => Promise<{ data: ProjectRow[] | null; error: { code?: string; message: string } | null }> };
      })
        .from("projects")
        .select("id, name, client, status, start_date, end_date");

      if (!active) return;

      if (error) {
        const msg = error.message?.toLowerCase() ?? "";
        // Postgres "undefined table" or PostgREST schema-cache miss
        if (error.code === "42P01" || error.code === "PGRST205" || msg.includes("does not exist") || msg.includes("schema cache")) {
          setMissing(true);
        } else {
          setMissing(true);
          // eslint-disable-next-line no-console
          console.warn("projects query error:", error);
        }
        setRows([]);
      } else {
        setRows(data ?? []);
      }
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <div className="text-xs uppercase tracking-widest text-primary">Projects</div>
        <h1 className="text-3xl font-semibold tracking-tight">All projects</h1>
      </header>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !rows || rows.length === 0 ? (
        <Card className="border-dashed border-border bg-transparent p-12 text-center">
          <p className="text-sm text-muted-foreground">
            {missing ? "No projects yet." : "No projects yet."}
          </p>
        </Card>
      ) : (
        <Card className="border-border overflow-hidden">
          <div className="grid grid-cols-12 gap-4 border-b border-border px-6 py-3 text-xs uppercase tracking-wider text-muted-foreground">
            <div className="col-span-4">Project</div>
            <div className="col-span-3">Client</div>
            <div className="col-span-2">Status</div>
            <div className="col-span-3">Dates</div>
          </div>
          <ul className="divide-y divide-border">
            {rows.map((p) => (
              <li
                key={p.id}
                className="grid grid-cols-12 gap-4 px-6 py-4 text-sm hover:bg-secondary/40 transition-colors"
              >
                <div className="col-span-4 font-medium">{p.name ?? "Untitled"}</div>
                <div className="col-span-3 text-muted-foreground">{p.client ?? "—"}</div>
                <div className="col-span-2">
                  {p.status ? (
                    <Badge variant="secondary" className="capitalize">
                      {p.status}
                    </Badge>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </div>
                <div className="col-span-3 text-muted-foreground">
                  {formatDate(p.start_date)} – {formatDate(p.end_date)}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
