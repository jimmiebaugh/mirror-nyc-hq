import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RecordCombobox, type Option } from "@/components/ui/RecordCombobox";
import { supabase } from "@/integrations/supabase/client";
import type {
  EntityConfig,
  ParsedSheet,
  RefMappings,
  RefResolution,
  UnresolvedRef,
  UnresolvedRefConfig,
} from "@/lib/hq/bulkImport/types";

/**
 * Step 2: resolve every unrecognized reference value found in the parsed
 * sheet. Each row maps to an existing record (or, for client / venue, queues
 * an inline create). The MapStep never writes to the DB; queued creates ride
 * along with the commit payload.
 *
 *   - name-mode kinds (client, venue): RecordCombobox over the live table.
 *     Exact name matches auto-resolve on load; "Create new" queues the value.
 *   - email-mode kind (user): RecordCombobox over active staff, keyed by
 *     email. No inline create — an unmatched email blocks advance with a
 *     destructive helper pointing at /users.
 */

export type MapStepValue = RefMappings;

export function MapStep({
  config,
  parsed,
  unresolved,
  value,
  onChange,
}: {
  config: EntityConfig;
  parsed: ParsedSheet;
  unresolved: UnresolvedRef[];
  value: MapStepValue;
  onChange: (next: MapStepValue) => void;
}) {
  const orderedKinds = useMemo(() => orderByDependency(config.unresolvedRefConfig), [config]);
  const byKind = useMemo(() => {
    const out = new Map<string, UnresolvedRef[]>();
    for (const ref of unresolved) {
      const list = out.get(ref.kind) ?? [];
      list.push(ref);
      out.set(ref.kind, list);
    }
    return out;
  }, [unresolved]);

  if (unresolved.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border py-12 text-center">
        <p className="text-sm text-muted-foreground">
          Every reference value resolved cleanly. Continue to the next step.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Each unrecognized value below needs to map to an existing record. Clients and venues can be queued for create; Mirror staff must already exist in the Team page.
      </p>

      {orderedKinds.map((kind) => {
        const refs = byKind.get(kind) ?? [];
        if (refs.length === 0) return null;
        const cfg = config.unresolvedRefConfig[kind];
        return (
          <KindGroup
            key={kind}
            cfg={cfg}
            refs={refs}
            resolutions={value[kind] ?? {}}
            onChange={(next) => onChange({ ...value, [kind]: next })}
          />
        );
      })}
    </div>
  );
}

function orderByDependency(cfgs: Record<string, UnresolvedRefConfig>): string[] {
  const out: string[] = [];
  const visited = new Set<string>();
  const visit = (k: string) => {
    if (visited.has(k)) return;
    visited.add(k);
    const cfg = cfgs[k];
    if (cfg?.dependsOn) {
      for (const dep of cfg.dependsOn) visit(dep);
    }
    out.push(k);
  };
  for (const k of Object.keys(cfgs)) visit(k);
  return out;
}

function KindGroup({
  cfg,
  refs,
  resolutions,
  onChange,
}: {
  cfg?: UnresolvedRefConfig;
  refs: UnresolvedRef[];
  resolutions: Record<string, RefResolution>;
  onChange: (next: Record<string, RefResolution>) => void;
}) {
  const label = cfg?.label ?? "References";
  const mode = cfg?.resolverMode ?? "name";
  const allowCreate = cfg?.allowCreate ?? true;
  const [open, setOpen] = useState(true);
  const [options, setOptions] = useState<Option[]>([]);
  const [loading, setLoading] = useState(true);
  const autoMatchedRef = useRef(false);

  const rawKey = useMemo(() => refs.map((r) => r.raw_value).join(""), [refs]);

  // Load the resolver table's options + auto-resolve exact matches once.
  useEffect(() => {
    if (!cfg) return;
    let cancelled = false;
    setLoading(true);
    autoMatchedRef.current = false;
    (async () => {
      const opts = await loadResolverOptions(cfg);
      if (cancelled) return;
      setOptions(opts);
      setLoading(false);
      // Auto-resolve: match each raw value (case-insensitive) to an option.
      const byMatch = new Map<string, string>();
      for (const o of opts) byMatch.set(o.label.toLowerCase(), o.id);
      const matchKey = (raw: string) =>
        mode === "email" ? raw.trim().toLowerCase() : raw.trim().toLowerCase();
      // For email mode option labels are "Name <email>"; match on the id (email).
      const byId = new Map<string, string>();
      for (const o of opts) byId.set(o.id.toLowerCase(), o.id);

      let mutated = false;
      const next = { ...resolutions };
      for (const ref of refs) {
        if (next[ref.raw_value]?.selection != null) continue;
        let selection: string | null = null;
        if (mode === "email") {
          selection = byId.get(matchKey(ref.raw_value)) ?? null;
        } else {
          selection = byMatch.get(matchKey(ref.raw_value)) ?? null;
        }
        if (selection != null) {
          next[ref.raw_value] = {
            raw_value: ref.raw_value,
            selection,
            createFields: {},
          };
          mutated = true;
        }
      }
      if (mutated && !autoMatchedRef.current) {
        autoMatchedRef.current = true;
        onChange(next);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawKey, cfg?.resolverTable, mode]);

  const loadExisting = useCallback(async () => options, [options]);

  const update = (raw: string, patch: Partial<RefResolution>) => {
    onChange({
      ...resolutions,
      [raw]: {
        raw_value: raw,
        selection: resolutions[raw]?.selection ?? null,
        createFields: resolutions[raw]?.createFields ?? {},
        ...patch,
      },
    });
  };

  return (
    <div className="rounded-md border border-border bg-surface-alt">
      <button
        type="button"
        className="flex w-full items-center justify-between px-4 py-3 text-left"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="h-card">{label}</span>
        <span className="text-xs text-muted-foreground">
          {refs.length} value{refs.length === 1 ? "" : "s"} · {open ? "hide" : "show"}
        </span>
      </button>
      {open ? (
        loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          </div>
        ) : (
          <div className="divide-y divide-border">
            {refs.map((ref) => {
              const res = resolutions[ref.raw_value];
              const isQueued = res?.selection === "";
              const unresolvedUser =
                mode === "email" && (res?.selection == null || res.selection === "");
              return (
                <div key={ref.raw_value} className="grid grid-cols-12 gap-3 px-4 py-3">
                  <div className="col-span-4 self-center">
                    <div className="font-mono text-sm text-foreground">{ref.raw_value}</div>
                    <div className="text-xs text-muted-foreground">
                      found in {ref.row_indices.length} row{ref.row_indices.length === 1 ? "" : "s"}
                    </div>
                  </div>

                  <div className="col-span-5 self-center">
                    {mode === "email" ? (
                      <>
                        <RecordCombobox
                          source={{ kind: "users-by-email" }}
                          entityLabel="staff member"
                          placeholder="Match to a Mirror staff member…"
                          value={res?.selection && res.selection !== "" ? res.selection : null}
                          onChange={(next) => update(ref.raw_value, { selection: next })}
                        />
                        {unresolvedUser ? (
                          <div className="mt-1 text-[11px] text-destructive">
                            User not found.{" "}
                            <Link to="/users/new" className="tlink">
                              Pre-provision in /users
                            </Link>{" "}
                            first.
                          </div>
                        ) : null}
                      </>
                    ) : (
                      <RecordCombobox
                        source={{ kind: "record", loadOptions: loadExisting }}
                        entityLabel={label.toLowerCase()}
                        placeholder={`Match to an existing ${label.toLowerCase().replace(/s$/, "")}…`}
                        value={res?.selection && res.selection !== "" ? res.selection : null}
                        onChange={(next) => update(ref.raw_value, { selection: next })}
                        disabled={isQueued}
                      />
                    )}
                  </div>

                  <div className="col-span-3 self-center">
                    {mode !== "email" && allowCreate ? (
                      <Button
                        type="button"
                        variant={isQueued ? "default" : "outline"}
                        onClick={() =>
                          update(ref.raw_value, {
                            selection: isQueued ? null : "",
                            createFields: isQueued ? {} : { name: ref.raw_value },
                          })
                        }
                      >
                        {isQueued ? "Queued for create" : "Create new"}
                      </Button>
                    ) : null}
                  </div>

                  {isQueued ? (
                    <div className="col-span-12 grid grid-cols-2 gap-3 rounded-md border border-border bg-background p-3">
                      {(cfg?.createFields ?? []).map((field) => (
                        <label key={field.key} className="space-y-1">
                          <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                            {field.label}
                            {field.required ? <span className="ml-1 text-primary">*</span> : null}
                          </div>
                          <Input
                            value={res?.createFields[field.key] ?? ""}
                            onChange={(e) =>
                              update(ref.raw_value, {
                                createFields: {
                                  ...(res?.createFields ?? {}),
                                  [field.key]: e.target.value,
                                },
                              })
                            }
                          />
                        </label>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )
      ) : null}
    </div>
  );
}

async function loadResolverOptions(cfg: UnresolvedRefConfig): Promise<Option[]> {
  if ((cfg.resolverMode ?? "name") === "email") {
    const { data, error } = await supabase
      .from("users")
      .select("email, full_name")
      .eq("active", true)
      .order("full_name", { ascending: true });
    if (error || !data) return [];
    return data
      .filter((u) => u.email)
      .map((u) => ({
        id: u.email as string,
        label: u.full_name ? `${u.full_name} <${u.email}>` : (u.email as string),
      }));
  }
  // name mode: clients / venues both expose id + name.
  const table = cfg.resolverTable as "clients" | "venues";
  const { data, error } = await supabase
    .from(table)
    .select("id, name")
    .order("name", { ascending: true })
    .limit(1000);
  if (error || !data) return [];
  return data
    .filter((r) => r.name)
    .map((r) => ({ id: r.id as string, label: r.name as string }));
}
