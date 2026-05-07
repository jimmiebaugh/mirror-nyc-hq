import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { FileText, FileType2, Link as LinkIcon, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";
import { StatusDropdown } from "@/components/talent-scout/StatusDropdown";
import { getScoreColor } from "@/lib/talent-scout/scoreColor";
import { cn } from "@/lib/utils";
import type { Database } from "@/integrations/supabase/types";

type CandidateRow = Database["public"]["Tables"]["ts_candidates"]["Row"];
type AttachmentRow = Database["public"]["Tables"]["ts_candidate_attachments"]["Row"];
type RoleRow = Database["public"]["Tables"]["ts_roles"]["Row"];

type Criterion = {
  name: string;
  tier: 1 | 2 | 3;
  weight: number;
  is_disqualifier?: boolean;
  full_points_rubric?: string;
};

type DetectedLink = { url: string; type?: string };

// Tier colors aligned with source's tier-badge--{1,2,3} (Phase 3.5b):
// T1 red-500 (#ef4444), T2 amber-500 (#f59e0b), T3 green-400 (#4ade80).
// HQ pre-3.5b used emerald-500/400 for T3 — replaced with green-400 to match
// source's #4ade80 success hue exactly.
const TIER_META = {
  1: { label: "Tier 1 — Must-Haves", color: "bg-red-500/10 border-red-500/30 text-red-500" },
  2: { label: "Tier 2 — Strong Differentiators", color: "bg-amber-500/10 border-amber-500/30 text-amber-500" },
  3: { label: "Tier 3 — Nice-to-Haves", color: "bg-green-400/10 border-green-400/30 text-green-400" },
} as const;

function fileBadge(mime: string | null | undefined) {
  const m = mime ?? "";
  if (m.includes("pdf")) return { label: "PDF", icon: FileText };
  if (m.includes("word") || m.includes("officedocument")) return { label: "DOC", icon: FileType2 };
  return { label: m.split("/")[1]?.toUpperCase().slice(0, 4) ?? "FILE", icon: FileText };
}

function fmtSize(n: number | null | undefined) {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function urlTypeLabel(t?: string) {
  switch (t) {
    case "portfolio_site": return "PORTFOLIO";
    case "vimeo_reel": return "VIMEO";
    case "drive_folder": return "DRIVE";
    default: return "LINK";
  }
}

async function openSignedFile(path: string) {
  const { data, error } = await supabase.storage
    .from("candidate_attachments")
    .createSignedUrl(path, 60);
  if (error || !data?.signedUrl) {
    toast({ title: "Couldn't open file", description: error?.message ?? "no URL returned", variant: "destructive" });
    return;
  }
  window.open(data.signedUrl, "_blank", "noopener");
}

export default function CandidateDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const [cand, setCand] = useState<CandidateRow | null>(null);
  const [attachments, setAttachments] = useState<AttachmentRow[]>([]);
  const [role, setRole] = useState<RoleRow | null>(null);
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [reevaluating, setReevaluating] = useState(false);
  const notesTimer = useRef<number | null>(null);

  const load = async () => {
    if (!id) return;
    const { data: c } = await supabase.from("ts_candidates").select("*").eq("id", id).maybeSingle();
    if (!c) { setLoading(false); return; }
    setCand(c as CandidateRow);
    setNotes((c.internal_notes as string | null) ?? "");
    const [{ data: r }, { data: atts }] = await Promise.all([
      supabase.from("ts_roles").select("*").eq("id", c.role_id).maybeSingle(),
      supabase.from("ts_candidate_attachments").select("*").eq("candidate_id", id).order("attachment_type"),
    ]);
    setRole((r as RoleRow | null) ?? null);
    setAttachments((atts as AttachmentRow[]) ?? []);
    setLoading(false);
  };

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]);

  useEffect(() => {
    const name = cand?.name?.trim();
    document.title = name ? `${name} · Candidate · Mirror NYC HQ` : "Candidate · Mirror NYC HQ";
    return () => { document.title = "Mirror NYC HQ"; };
  }, [cand?.name]);

  const saveNotes = async (val: string) => {
    if (!id) return;
    const { error } = await supabase.from("ts_candidates").update({ internal_notes: val }).eq("id", id);
    if (error) toast({ title: "Notes save failed", description: error.message, variant: "destructive" });
  };

  const onNotesChange = (v: string) => {
    setNotes(v);
    if (notesTimer.current) window.clearTimeout(notesTimer.current);
    notesTimer.current = window.setTimeout(() => saveNotes(v), 1200);
  };

  const reevaluate = async () => {
    if (!id || reevaluating) return;
    setReevaluating(true);
    const { data, error } = await supabase.functions.invoke<{ ok?: boolean; score?: number; error?: string }>(
      "ts-evaluate-candidate",
      { body: { candidate_id: id, triggered_by_user_id: user?.id ?? null } },
    );
    setReevaluating(false);
    const errMsg = error?.message ?? data?.error ?? null;
    if (errMsg) {
      toast({ title: "Re-evaluate failed", description: errMsg, variant: "destructive" });
      return;
    }
    toast({ title: "Re-evaluated", description: data?.score != null ? `New score: ${Math.round(data.score)}` : "Done" });
    await load();
  };

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!cand) {
    return (
      <Card>
        <CardContent className="space-y-3 p-8 text-center">
          <p className="text-sm">Candidate not found.</p>
          <Button variant="ghost" asChild>
            <Link to="/talent-scout">← Back to roles</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const criteria = ((role?.scorecard as unknown as Criterion[]) ?? []).map((c) => ({
    ...c,
    tier: (Number(c.tier) as 1 | 2 | 3),
  }));
  const grouped: Record<1 | 2 | 3, Criterion[]> = { 1: [], 2: [], 3: [] };
  for (const c of criteria) (grouped[c.tier] ?? grouped[1]).push(c);
  const scoresByCriterion = (cand.score_breakdown as Record<string, number> | null) ?? {};
  const detectedLinks = (cand.detected_links as DetectedLink[] | null) ?? [];
  const portfolioPath = cand.portfolio_type === "file" ? cand.portfolio_path_or_url : null;
  const portfolioWeb = cand.portfolio_type === "url" ? cand.portfolio_path_or_url : null;
  const total = cand.score == null ? 0 : Number(cand.score);

  return (
    <div className="space-y-6">
      <Link
        to={cand.role_id ? `/talent-scout/roles/${cand.role_id}` : "/talent-scout"}
        className="text-xs font-mono uppercase tracking-widest text-primary hover:underline"
      >
        ← Back to {role?.title ?? "role"}
      </Link>

      <header className="flex items-start justify-between gap-6">
        <div className="min-w-0 space-y-2">
          <h1 className="h-page">{cand.name ?? "Unnamed candidate"}</h1>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span>{cand.email ?? "—"}</span>
            {cand.location && (
              <>
                <span>·</span>
                <span>{cand.location}</span>
              </>
            )}
            {cand.applied_date && (
              <>
                <span>·</span>
                <span>Applied {new Date(cand.applied_date).toLocaleDateString()}</span>
              </>
            )}
            {cand.last_evaluated_at && (
              <>
                <span>·</span>
                <span>Last evaluated {new Date(cand.last_evaluated_at).toLocaleString()}</span>
              </>
            )}
          </div>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2.5">
          <Button variant="outline" onClick={reevaluate} disabled={reevaluating}>
            <RefreshCw className={cn("mr-2 h-4 w-4", reevaluating && "animate-spin")} />
            {reevaluating ? "Re-evaluating…" : "Re-evaluate"}
          </Button>
          <StatusDropdown
            candidateId={cand.id}
            value={cand.status}
            onChange={(v) => setCand((c) => (c ? { ...c, status: v } : c))}
            size="large"
          />
        </div>
      </header>

      <div className="grid gap-6 md:grid-cols-2">
        {/* LEFT */}
        <div className="space-y-6 min-w-0">
          {cand.recruiter_overview && (
            <Card>
              <CardContent className="space-y-3 p-6">
                <div className="flex items-start justify-between gap-4">
                  <div className="text-[13px] font-mono font-bold uppercase tracking-wider text-primary">
                    Recruiter Overview
                  </div>
                  <div
                    className="font-display text-3xl font-extrabold leading-none tabular-nums"
                    style={{ color: getScoreColor(total) }}
                  >
                    {total}
                  </div>
                </div>
                <p className="whitespace-pre-line text-sm text-foreground">{cand.recruiter_overview}</p>
              </CardContent>
            </Card>
          )}

          <Card className="overflow-hidden">
            <div className="border-b border-border px-6 py-4 text-[13px] font-mono font-bold uppercase tracking-wider text-primary">
              Files & Materials
            </div>
            {attachments.length === 0 && detectedLinks.length === 0 && !portfolioPath && !portfolioWeb && (
              <div className="px-6 py-6 text-sm text-muted-foreground">No files or links.</div>
            )}
            <div className="divide-y divide-border">
              {attachments.map((a) => {
                const b = fileBadge(a.file_name);
                const Icon = b.icon;
                return (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => openSignedFile(a.file_path)}
                    className="flex w-full items-center gap-4 px-6 py-3 text-left hover:bg-secondary/40"
                  >
                    <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-sm border border-primary/30 bg-primary/10">
                      <Icon className="h-4 w-4 text-primary" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-bold">{a.file_name}</div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {a.attachment_type.replace("_", " ")} · {b.label}
                        {a.file_size_bytes ? ` · ${fmtSize(a.file_size_bytes)}` : ""}
                      </div>
                    </div>
                    <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-muted-foreground">Open ↗</span>
                  </button>
                );
              })}
              {detectedLinks.map((u) => (
                <a
                  key={u.url}
                  href={u.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex w-full items-center gap-4 px-6 py-3 hover:bg-secondary/40"
                >
                  <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-sm border border-border bg-secondary">
                    <LinkIcon className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-bold">{u.url}</div>
                    <div className="mt-0.5 text-[10px] font-mono font-bold uppercase tracking-wider text-muted-foreground">
                      {urlTypeLabel(u.type)}
                    </div>
                  </div>
                  <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-muted-foreground">Open ↗</span>
                </a>
              ))}
            </div>

            {(portfolioPath || portfolioWeb) && (
              <>
                <div className="border-t border-border bg-secondary/30 px-6 py-3 text-[13px] font-mono font-bold uppercase tracking-wider text-primary">
                  Portfolio
                </div>
                <div className="divide-y divide-border">
                  {portfolioPath && (
                    <button
                      type="button"
                      onClick={() => openSignedFile(portfolioPath)}
                      className="flex w-full items-center gap-4 px-6 py-3 text-left hover:bg-secondary/40"
                    >
                      <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-sm border border-primary/30 bg-primary/10">
                        <FileText className="h-4 w-4 text-primary" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-bold">
                          <span className="font-normal text-muted-foreground">Portfolio (file): </span>
                          {portfolioPath.split("/").pop()}
                        </div>
                      </div>
                      <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-muted-foreground">Open ↗</span>
                    </button>
                  )}
                  {portfolioWeb && (
                    <a
                      href={portfolioWeb}
                      target="_blank"
                      rel="noreferrer"
                      className="flex w-full items-center gap-4 px-6 py-3 hover:bg-secondary/40"
                    >
                      <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-sm border border-border bg-secondary">
                        <LinkIcon className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-bold">
                          <span className="font-normal text-muted-foreground">Portfolio (web): </span>
                          {portfolioWeb}
                        </div>
                      </div>
                      <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-muted-foreground">Open ↗</span>
                    </a>
                  )}
                </div>
              </>
            )}
          </Card>

          {(cand.top_strengths as unknown[] | null)?.length ? (
            <Card>
              <CardContent className="space-y-3 p-6">
                <div className="text-[13px] font-mono font-bold uppercase tracking-wider text-primary">Top Strengths</div>
                <ul className="space-y-2 text-sm">
                  {(cand.top_strengths as string[]).map((s, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="font-bold text-primary">—</span>
                      <span>{s}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}

          {(cand.key_gaps as unknown[] | null)?.length ? (
            <Card>
              <CardContent className="space-y-3 p-6">
                <div className="text-[13px] font-mono font-bold uppercase tracking-wider text-primary">Key Gaps</div>
                <ul className="space-y-2 text-sm">
                  {(cand.key_gaps as string[]).map((s, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="font-bold text-primary">—</span>
                      <span>{s}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}
        </div>

        {/* RIGHT */}
        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <CardContent className="space-y-3 p-6">
              <div className="text-[13px] font-mono font-bold uppercase tracking-wider text-primary">Internal Notes</div>
              <Textarea
                value={notes}
                onChange={(e) => onNotesChange(e.target.value)}
                onBlur={() => saveNotes(notes)}
                placeholder="Notes save automatically…"
                className="min-h-[140px]"
              />
              <p className="text-xs text-muted-foreground">
                Saved automatically · folded into the prompt as hiring-manager input on next re-evaluation.
              </p>
            </CardContent>
          </Card>

          <Card className="overflow-hidden">
            <div className="border-b border-border px-6 py-4 text-[13px] font-mono font-bold uppercase tracking-wider text-primary">
              Score Breakdown
            </div>
            <div className="space-y-5 p-6">
              {([1, 2, 3] as const).map((t) => (
                <div key={t}>
                  <div className="mb-2 flex items-center justify-between">
                    <span className={cn("inline-flex items-center rounded-sm border px-2 py-0.5 text-[10px] font-mono font-bold uppercase tracking-wider", TIER_META[t].color)}>
                      {TIER_META[t].label}
                    </span>
                    <span className="text-[10px] font-mono font-bold uppercase tracking-wider tabular-nums text-muted-foreground">
                      {grouped[t].reduce((s, c) => s + (c.weight ?? 0), 0)} pts
                    </span>
                  </div>
                  <ul className="space-y-1.5">
                    {grouped[t].length === 0 && <li className="text-xs text-muted-foreground">—</li>}
                    {grouped[t].map((c) => {
                      const got = scoresByCriterion[c.name] ?? 0;
                      return (
                        <li key={c.name} className="flex items-center justify-between gap-3 text-xs">
                          <span className="truncate text-muted-foreground">{c.name}</span>
                          <span className="whitespace-nowrap font-bold tabular-nums">
                            <span className="text-foreground">{got}</span>
                            <span className="text-muted-foreground"> / {c.weight}</span>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
            {(() => {
              const base = Object.values(scoresByCriterion).reduce((s, n) => s + (Number(n) || 0), 0);
              const bonus = Math.max(0, total - base);
              return (
                <div className="flex items-end justify-between border-t border-border bg-secondary/30 p-6">
                  <div>
                    <div className="text-[13px] font-mono font-bold uppercase tracking-wider text-muted-foreground">Total</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {bonus > 0 ? `${base} base + ${bonus} bonus` : `${base} pts`}
                      {cand.tier ? ` · Tier ${cand.tier}` : ""}
                    </div>
                  </div>
                  <div
                    className="font-display text-4xl font-extrabold leading-none tabular-nums"
                    style={{ color: getScoreColor(total) }}
                  >
                    {total}
                  </div>
                </div>
              );
            })()}
          </Card>

        </div>
      </div>
    </div>
  );
}
