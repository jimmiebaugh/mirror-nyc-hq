// Phase 4.9-port: Scout Settings -- rename a scout, change its project
// link, or Start Over (cascade-delete candidate venues + photos, reset
// current_step back to sheet_prompt).
//
// HQ-from-scratch per port plan § 9. VS Pro has no Settings page; it
// surfaces Start Over inside PageHeader.tsx as a per-page button. Port
// plan consolidates rename + project link + Start Over into a single
// surface. Closest HQ analog: RoleSettings.tsx (Talent Scout) for the
// edit-form + sticky-save-bar + cancel-leave-dialog pattern.
//
// Start Over flow lives in the Danger Zone card at the bottom. Opens an
// AlertDialog with cascade-preview counts (candidate venues + venue
// photos) before confirming. On confirm, calls the start_over_scout RPC
// (Phase 4.9-port migration) which transactionally resets scout state
// + deletes vs_candidate_venues (photos cascade via FK).

import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";

// Sentinel value used by the Project select to represent "no project".
// shadcn's Select rejects empty-string values, so we use a non-empty
// placeholder and translate it to null on save.
const STANDALONE = "__standalone__";

type ScoutMeta = {
  id: string;
  name: string | null;
  project_id: string | null;
  current_step: string | null;
  status: string | null;
};

type ProjectOption = { id: string; name: string | null };

type SettingsFormState = {
  name: string;
  project_id: string | null;
};

type CascadeCounts = { venues: number; photos: number };

type LoadStatus = "loading" | "ok" | "not-found";

export default function ScoutSettings() {
  const { id = "" } = useParams<{ id: string }>();
  const nav = useNavigate();
  const { user } = useAuth();

  // ----------- All hooks above any early return (design-system § 12 #2) -----

  // Loaded data
  const [scout, setScout] = useState<ScoutMeta | null>(null);
  const [loadStatus, setLoadStatus] = useState<LoadStatus>("loading");
  const [projects, setProjects] = useState<ProjectOption[]>([]);

  // Form state
  const [initial, setInitial] = useState<SettingsFormState>({
    name: "",
    project_id: null,
  });
  const [form, setForm] = useState<SettingsFormState>({
    name: "",
    project_id: null,
  });
  const [touched, setTouched] = useState<{ name: boolean }>({ name: false });
  const [saving, setSaving] = useState(false);

  // Cancel-with-dirty dialog
  const [confirmLeaveOpen, setConfirmLeaveOpen] = useState(false);
  const pendingNavRef = useRef<string | null>(null);

  // Start Over state
  const [startOverOpen, setStartOverOpen] = useState(false);
  const [counts, setCounts] = useState<CascadeCounts | null>(null);
  const [startingOver, setStartingOver] = useState(false);
  // Generation counter for cascade-preview counts. If the producer rapidly
  // re-opens the dialog (or the component unmounts mid-flight), drop stale
  // response so we don't setCounts on a closed dialog or unmounted tree.
  // Same pattern Brief.tsx uses for upload+parse races.
  const cascadeGenRef = useRef(0);

  // -------------------- Derived state --------------------
  const dirty = useMemo(() => {
    return (
      initial.name !== form.name ||
      (initial.project_id ?? null) !== (form.project_id ?? null)
    );
  }, [initial, form]);
  const canSave = form.name.trim() !== "";

  // -------------------- Mount: parallel fetch scout + projects --------------
  useEffect(() => {
    if (!id) return;
    let active = true;
    (async () => {
      const [scoutRes, projectsRes] = await Promise.all([
        supabase
          .from("vs_scouts")
          .select("id, name, project_id, current_step, status")
          .eq("id", id)
          .maybeSingle(),
        supabase
          .from("projects")
          .select("id, name")
          .is("archived_at", null)
          .order("name", { ascending: true }),
      ]);
      if (!active) return;
      const s = (scoutRes.data as ScoutMeta | null) ?? null;
      if (!s) {
        setLoadStatus("not-found");
        return;
      }
      setScout(s);
      const f: SettingsFormState = {
        name: s.name ?? "",
        project_id: s.project_id ?? null,
      };
      setForm(f);
      setInitial(f);
      setProjects((projectsRes.data ?? []) as ProjectOption[]);
      setLoadStatus("ok");
    })();
    return () => {
      active = false;
    };
  }, [id]);

  // -------------------- beforeunload guard for tab-close / hard-reload -----
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  // -------------------- Loading / not-found gates --------------------
  if (loadStatus === "loading") {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }
  if (loadStatus === "not-found" || !scout) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 pt-12 text-center">
        <h1 className="h-page">Scout not found</h1>
        <p className="text-sm text-muted-foreground">
          We couldn't find a scout with that id.
        </p>
        <Link to="/venue-scout" className="crumb">
          ← Back to Venue Scout
        </Link>
      </div>
    );
  }

  // -------------------- Helpers --------------------
  const updateField = <K extends keyof SettingsFormState>(
    k: K,
    v: SettingsFormState[K],
  ) => setForm((f) => ({ ...f, [k]: v }));

  const navigateOrConfirm = (target: string) => {
    if (dirty) {
      pendingNavRef.current = target;
      setConfirmLeaveOpen(true);
    } else {
      nav(target);
    }
  };

  // -------------------- Save flow --------------------
  const save = async () => {
    setTouched({ name: true });
    if (!canSave) return;
    setSaving(true);
    const { error } = await supabase
      .from("vs_scouts")
      .update({
        name: form.name.trim(),
        project_id: form.project_id,
        last_touched_at: new Date().toISOString(),
        updated_by: user?.id ?? null,
      })
      .eq("id", id);
    setSaving(false);
    if (error) {
      toast({
        title: "Save failed",
        description: error.message,
        variant: "destructive",
      });
      return;
    }
    toast({ title: "Settings saved" });
    setInitial(form);
    // Refresh the local scout meta so the header title reflects the saved
    // name (otherwise the next dirty calculation runs against stale state).
    setScout((s) =>
      s
        ? {
            ...s,
            name: form.name.trim(),
            project_id: form.project_id,
          }
        : s,
    );
  };

  // -------------------- Start Over flow --------------------
  // Two round-trips on dialog open: candidate venues is straight count,
  // photos has no scout_id column so we resolve venue ids then count
  // photos under those ids. Acceptable for a destructive-action preview.
  // cascadeGenRef drops stale responses (re-open / unmount race).
  const openStartOver = async () => {
    setStartOverOpen(true);
    setCounts(null);
    const myGen = ++cascadeGenRef.current;
    const { count: venueCount } = await supabase
      .from("vs_candidate_venues")
      .select("id", { count: "exact", head: true })
      .eq("scout_id", id);
    if (myGen !== cascadeGenRef.current) return;
    const { data: venueIds } = await supabase
      .from("vs_candidate_venues")
      .select("id")
      .eq("scout_id", id);
    if (myGen !== cascadeGenRef.current) return;
    const ids = (venueIds ?? []).map((v) => v.id as string);
    let photoCount = 0;
    if (ids.length > 0) {
      const { count } = await supabase
        .from("vs_venue_photos")
        .select("id", { count: "exact", head: true })
        .in("candidate_venue_id", ids);
      if (myGen !== cascadeGenRef.current) return;
      photoCount = count ?? 0;
    }
    setCounts({ venues: venueCount ?? 0, photos: photoCount });
  };

  const confirmStartOver = async () => {
    setStartingOver(true);
    const { error } = await supabase.rpc("start_over_scout", {
      target_scout_id: id,
    });
    setStartingOver(false);
    if (error) {
      toast({
        title: "Start Over failed",
        description: error.message,
        variant: "destructive",
      });
      return;
    }
    setStartOverOpen(false);
    toast({ title: "Scout reset" });
    nav(`/venue-scout/scouts/${id}/brief`);
  };

  // -------------------- Render --------------------
  return (
    <div className="mx-auto max-w-3xl space-y-6 pb-32">
      <Link to={`/venue-scout/scouts/${id}/brief`} className="crumb">
        ← {scout.name ?? "Scout"}
      </Link>
      <header className="space-y-2">
        <div className="text-[14px] font-mono uppercase tracking-widest text-primary">
          Settings
        </div>
        <h1 className="h-page">{scout.name ?? "Scout"}</h1>
        <p className="text-sm text-muted-foreground">
          Rename the scout, change its project link, or start over.
        </p>
      </header>

      {/* ---- Edit fields ---- */}
      <Card className="bg-surface-alt">
        <CardContent className="space-y-6 p-6">
          <Field label="Scout name" required>
            <Input
              value={form.name}
              onChange={(e) => updateField("name", e.target.value)}
              onBlur={() => setTouched((p) => ({ ...p, name: true }))}
              placeholder="e.g. Glossier - Summer Pop-up"
            />
            {touched.name && form.name.trim() === "" && (
              <p className="mt-1 text-xs text-destructive">Required.</p>
            )}
            <p className="mt-1 text-xs text-muted-foreground">
              Defaults to {`{client_name} - {event_name}`} from the brief. Rename here to override.
            </p>
          </Field>

          <Field label="Project">
            <Select
              value={form.project_id ?? STANDALONE}
              onValueChange={(v) =>
                updateField("project_id", v === STANDALONE ? null : v)
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Standalone (no project)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={STANDALONE}>Standalone (no project)</SelectItem>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name ?? "(unnamed project)"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="mt-1 text-xs text-muted-foreground">
              Optional. Link this scout to an HQ project record.
            </p>
          </Field>
        </CardContent>
      </Card>

      {/* ---- Danger Zone ---- */}
      <Card className="border-destructive/40 bg-card">
        <CardContent className="space-y-4 p-6">
          <div className="space-y-1">
            <div className="text-[13px] font-mono font-bold uppercase tracking-wider text-destructive">
              Danger Zone
            </div>
            <p className="text-xs text-muted-foreground">
              Irreversible actions. Read the dialog before confirming.
            </p>
          </div>

          <div className="flex items-start justify-between gap-4 rounded-md border border-border bg-surface-alt p-4">
            <div className="min-w-0 space-y-1">
              <div className="text-sm font-semibold">Start Over</div>
              <p className="text-xs text-muted-foreground">
                Deletes all candidate venues and venue photos for this scout. The brief, project link, and any generated decks are kept. The scout resets to the sheet-prompt step (back to the start of sourcing).
              </p>
            </div>
            <Button
              variant="ghost"
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={() => void openStartOver()}
            >
              Start Over...
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ---- Sticky save bar ---- */}
      <div className="sticky bottom-0 z-10 -mx-6 mt-6 border-t-2 border-primary/40 bg-background/90 px-6 py-4 backdrop-blur supports-[backdrop-filter]:bg-background/75">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
          <Button
            variant="ghost"
            onClick={() =>
              navigateOrConfirm(`/venue-scout/scouts/${id}/brief`)
            }
          >
            ← Cancel
          </Button>
          <div className="flex items-center gap-3">
            {dirty && (
              <span className="text-xs font-mono uppercase tracking-wider text-amber-400">
                Unsaved changes
              </span>
            )}
            <Button
              onClick={() => void save()}
              disabled={saving || !dirty || !canSave}
            >
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </div>
      </div>

      {/* ---- Cancel-with-dirty dialog ---- */}
      <AlertDialog open={confirmLeaveOpen} onOpenChange={setConfirmLeaveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unsaved changes</AlertDialogTitle>
            <AlertDialogDescription>
              You have unsaved edits. Leave anyway and discard them, or stay on this page?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => {
                pendingNavRef.current = null;
                setConfirmLeaveOpen(false);
              }}
            >
              Keep editing
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const target = pendingNavRef.current;
                pendingNavRef.current = null;
                setConfirmLeaveOpen(false);
                if (target) nav(target);
              }}
            >
              Discard changes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ---- Start Over dialog ---- */}
      <AlertDialog
        open={startOverOpen}
        onOpenChange={(o) => {
          if (!startingOver) setStartOverOpen(o);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Start over with this scout?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <div>This will delete:</div>
                <ul className="list-disc space-y-1 pl-5">
                  <li>
                    {counts === null ? "…" : counts.venues} candidate venue
                    {counts !== null && counts.venues === 1 ? "" : "s"}
                  </li>
                  <li>
                    {counts === null ? "…" : counts.photos} venue photo
                    {counts !== null && counts.photos === 1 ? "" : "s"}
                  </li>
                </ul>
                <div className="pt-2 text-sm">
                  The brief, project link, and any generated decks are kept. The scout resets to the sheet-prompt step (start of sourcing).
                </div>
                <div className="pt-2 font-semibold text-foreground">
                  This cannot be undone.
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={startingOver}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void confirmStartOver();
              }}
              disabled={startingOver}
              className="bg-red-500 text-white hover:bg-red-600"
            >
              {startingOver ? "Working…" : "Start Over"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline Field -- matches Brief.tsx / NewScout.tsx convention. Coral
// uppercase mono label, optional required asterisk.
// ---------------------------------------------------------------------------
function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label className="text-[13px] font-mono font-bold uppercase tracking-wider text-primary">
        {label}
        {required && <span className="ml-1 text-primary">*</span>}
      </Label>
      {children}
    </div>
  );
}
