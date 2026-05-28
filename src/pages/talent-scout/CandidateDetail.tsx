import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { FileText, FileType2, Link as LinkIcon, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";
import { StatusDropdown } from "@/components/talent-scout/StatusDropdown";
import { ReviewedPill } from "@/components/talent-scout/ReviewedPill";
import { ReferralPill } from "@/components/talent-scout/ReferralPill";
import { fmtRelative } from "@/lib/talent-scout/relativeTime";
import { getScoreColor } from "@/lib/talent-scout/scoreColor";
import { unwrapSecurityWrapper, dedupeUrls } from "@/lib/unwrapUrl";
import { cn } from "@/lib/utils";
import { TIER_META } from "@/lib/talent-scout/scorecard";
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

// Phase 3.7.8.11: RECOMMENDATION_TIER_STYLE removed. The tier pill it
// drove (originally in Score Breakdown's total row at 3.7.3.1, then
// moved to the header cluster at 3.7.3.6) is gone — recommendation_tier
// signal overlapped too closely with the status dropdown to justify
// its own pill.

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
      <section className="card">
        <div className="card-pad space-y-3 text-center">
          <p className="text-sm">Candidate not found.</p>
          <Button variant="ghost" asChild>
            <Link to="/talent-scout">Back to roles</Link>
          </Button>
        </div>
      </section>
    );
  }

  const criteria = ((role?.scorecard as unknown as Criterion[]) ?? []).map((c) => ({
    ...c,
    tier: (Number(c.tier) as 1 | 2 | 3),
  }));
  const grouped: Record<1 | 2 | 3, Criterion[]> = { 1: [], 2: [], 3: [] };
  for (const c of criteria) (grouped[c.tier] ?? grouped[1]).push(c);
  const scoresByCriterion = (cand.score_breakdown as Record<string, number> | null) ?? {};
  const portfolioPath = cand.portfolio_type === "file" ? cand.portfolio_path_or_url : null;
  const portfolioWeb = cand.portfolio_type === "url" ? cand.portfolio_path_or_url : null;
  // Phase 3.7.3.7: dedupe links by normalized URL form, exclude the portfolio
  // URL if it's also in the detected list (otherwise it'd render twice — once
  // in the Portfolio section and again under Resume & Files), and cap at 3
  // so the section stays scannable. Files (attachments) have no cap.
  const allDetectedLinks = (cand.detected_links as DetectedLink[] | null) ?? [];
  const detectedLinks = dedupeUrls(allDetectedLinks, portfolioWeb).slice(0, 3);
  // Phase 3.7.3.8: same idea on the file side. If the portfolio is a file
  // (portfolio_type='file'), drop that file from the Resume & Files list so
  // it only shows in the Portfolio section above.
  const displayedAttachments = portfolioPath
    ? attachments.filter((a) => a.file_path !== portfolioPath)
    : attachments;
  const total = cand.score == null ? 0 : Number(cand.score);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="flex flex-col items-start gap-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
        <div className="min-w-0 space-y-2">
          <h1 className="h-page">{cand.name ?? "Unnamed candidate"}</h1>
          <div className="detail-meta flex flex-wrap items-center gap-x-2 gap-y-1">
            {/* Phase 3.7.1.1: mailto link, muted coral. */}
            {cand.email ? (
              <a href={`mailto:${cand.email}`} className="text-primary/80 hover:text-primary hover:underline">
                {cand.email}
              </a>
            ) : (
              <span>—</span>
            )}
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
                <span title={new Date(cand.last_evaluated_at).toLocaleString()}>
                  Last evaluated {fmtRelative(cand.last_evaluated_at)}
                </span>
              </>
            )}
          </div>
        </div>
        {/* Phase 3.7.8.11: header right cluster simplified.
              LEFT  col (1 cell): Re-evaluate button, full-height
              RIGHT col (2 rows): [auto/manual + referral pills]
                                   [Status dropdown]
            Tier pill removed entirely (recommendation_tier already
            renders inside Score Breakdown content; the header pill
            was redundant with the status dropdown). Re-evaluate
            button now occupies the full height of the right-column
            stack, matching the visual weight of the controls beside
            it (was h-10 in 3.7.3.6). */}
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-shrink-0 sm:items-stretch sm:gap-1.5">
          {/* LEFT: Re-evaluate button, full height. */}
          <Button
            variant="outline"
            onClick={reevaluate}
            disabled={reevaluating}
            className="h-10 w-full sm:h-auto sm:w-[160px] sm:self-stretch"
          >
            <RefreshCw className={cn("mr-2 h-4 w-4", reevaluating && "animate-spin")} />
            {reevaluating ? "Re-evaluating…" : "Re-evaluate"}
          </Button>
          {/* RIGHT: 2-row stack — pills above, Status dropdown below. */}
          <div className="flex w-full flex-col items-stretch gap-1.5 sm:w-auto">
            <div className="flex flex-wrap items-stretch gap-1.5">
              <ReviewedPill
                manuallyReviewed={cand.manually_reviewed === true}
                candidateId={cand.id}
                onChanged={() =>
                  setCand((c) => (c ? { ...c, manually_reviewed: true } : c))
                }
                size="large"
              />
              {/* ReferralPill: shown when candidate was ingested via a
                   Mirror manager forward. Restyled to coral + white bold
                   in 3.7.8.8 so the signal reads as the brand color. */}
              {cand.is_referral === true && (
                <ReferralPill size="large" referrerEmail={cand.referrer_email} />
              )}
            </div>
            <StatusDropdown
              candidateId={cand.id}
              value={cand.status}
              onChange={(v) =>
                setCand((c) => (c ? { ...c, status: v, manually_reviewed: true } : c))
              }
              size="large"
            />
          </div>
        </div>
      </header>

      {/* Phase 3.7.3.3: two independent column stacks side-by-side, then
          two full-width rows below.
            LEFT  column: Resume & Files (Portfolio above)
            RIGHT column: Recruiter Overview → Internal Notes
            FULL row 1:   Strengths + Gaps (horizontal split)
            FULL row 2:   Score Breakdown (tiers horizontal)

          Each column flows on its own — Internal Notes sits right under
          Recruiter Overview with standard space-y-6 spacing, regardless
          of how tall Resume & Files is on the left. */}
      {/* Phase 3.7.6.7: items-stretch so the LEFT (Files combined) card
           grows to match the RIGHT (Recruiter Overview + Internal Notes
           combined) card's height — the two columns visually balance.
           Files card uses h-full inside the cell to stretch. */}
      {/* Phase 5.13.2c smoke: each labeled section becomes its own .card
           with .card-headbar + .h-card per design-system canon. Portfolio +
           Resume & Files split (was combined card with sub-headers);
           Recruiter Overview + Internal Notes split; Top Strengths + Key
           Gaps split into a 2-col grid; Score Breakdown carries Total in
           its headbar. */}
      <div className="grid items-start gap-6 md:grid-cols-2">
        {/* LEFT COLUMN — Portfolio + Resume & Files combined into ONE card.
             Each section keeps its own .card-headbar + .h-card; the second
             headbar sits inside the same card as a horizontal divider with
             section-title chrome. */}
        <div className="flex min-w-0 flex-col">
          <section className="card overflow-hidden">
            {(portfolioPath || portfolioWeb) && (
              <>
                <div className="card-headbar">
                  <span className="h-card">Portfolio</span>
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
                          {portfolioPath.split("/").pop()}
                        </div>
                      </div>
                      <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-muted-foreground">Open ↗</span>
                    </button>
                  )}
                  {portfolioWeb && (
                    <a
                      href={unwrapSecurityWrapper(portfolioWeb)}
                      target="_blank"
                      rel="noreferrer"
                      className="flex w-full items-center gap-4 px-6 py-3 hover:bg-secondary/40"
                    >
                      <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-sm border border-border bg-secondary">
                        <LinkIcon className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-bold">{portfolioWeb}</div>
                      </div>
                      <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-muted-foreground">Open ↗</span>
                    </a>
                  )}
                </div>
              </>
            )}
            {/* Resume & Files: second card-headbar inside the same card.
                 When Portfolio renders above, the top-border on this headbar
                 makes the section division explicit. */}
            <div className={cn("card-headbar", (portfolioPath || portfolioWeb) && "border-t")}>
              <span className="h-card">Resume &amp; Files</span>
            </div>
            {displayedAttachments.length === 0 && detectedLinks.length === 0 && (
              <div className="px-6 py-6 text-sm text-muted-foreground">No files or links.</div>
            )}
            <div className="divide-y divide-border">
              {displayedAttachments.map((a) => {
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
                  href={unwrapSecurityWrapper(u.url)}
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
          </section>
        </div>

        {/* RIGHT COLUMN — Recruiter Overview + Internal Notes combined into
             ONE shared .card with two .card-headbar sections inside. */}
        <div className="min-w-0">
          <section className="card overflow-hidden">
            <div className="card-headbar">
              <span className="h-card">Recruiter Overview</span>
              <div
                className="font-display text-3xl font-extrabold leading-none tabular-nums"
                style={{ color: getScoreColor(total) }}
              >
                {total}
              </div>
            </div>
            <div className="card-pad">
              <p className="whitespace-pre-line text-sm text-foreground">
                {cand.recruiter_overview ?? <span className="text-muted-foreground">—</span>}
              </p>
            </div>

            {/* Internal Notes: second card-headbar inside the same card,
                 border-t for the section divider. */}
            <div className="card-headbar border-t">
              <span className="h-card">Internal Notes</span>
            </div>
            <div className="card-pad space-y-3">
              <Textarea
                value={notes}
                onChange={(e) => onNotesChange(e.target.value)}
                onBlur={() => saveNotes(notes)}
                placeholder="Notes save automatically…"
                className="h-[80px] resize-none overflow-y-auto"
              />
              <p className="text-xs text-primary/80">
                Saved automatically. Considered in future re-evaluations.
              </p>
            </div>
          </section>
        </div>

        {/* STRENGTHS + GAPS — full width, two separate cards in a 2-col grid
             below the column stacks. Either card alone spans full width if
             the other is empty. */}
        {((cand.top_strengths as unknown[] | null)?.length ||
          (cand.key_gaps as unknown[] | null)?.length) ? (
          <div className="grid min-w-0 gap-6 md:col-span-2 md:grid-cols-2">
            {(cand.top_strengths as unknown[] | null)?.length ? (
              <section className="card overflow-hidden">
                <div className="card-headbar">
                  <span className="h-card">Top Strengths</span>
                </div>
                <div className="card-pad">
                  <ul className="space-y-2 text-sm">
                    {(cand.top_strengths as string[]).map((s, i) => (
                      <li key={i} className="flex gap-2">
                        {/* Sanctioned coral exception: bullet accent dashes
                            stay coral per Phase 5.13.2c spec. */}
                        <span className="font-bold text-primary">—</span>
                        <span>{s}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </section>
            ) : null}
            {(cand.key_gaps as unknown[] | null)?.length ? (
              <section className="card overflow-hidden">
                <div className="card-headbar">
                  <span className="h-card">Key Gaps</span>
                </div>
                <div className="card-pad">
                  <ul className="space-y-2 text-sm">
                    {(cand.key_gaps as string[]).map((s, i) => (
                      <li key={i} className="flex gap-2">
                        {/* Sanctioned coral exception. */}
                        <span className="font-bold text-primary">—</span>
                        <span>{s}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </section>
            ) : null}
          </div>
        ) : null}

        {/* SCORE BREAKDOWN — spans both columns. Tiers laid out
             horizontally (3 columns). */}
        <div className="min-w-0 md:col-span-2">
          <section className="card overflow-hidden">
            <div className="card-headbar">
              <span className="h-card">Score Breakdown</span>
              <div className="flex items-baseline gap-2">
                <span className="label-form">Total</span>
                <span
                  className="font-display text-3xl font-extrabold leading-none tabular-nums"
                  style={{ color: getScoreColor(total) }}
                >
                  {total}
                </span>
              </div>
            </div>
            {/* Phase 3.7.8.5: gap-6 → gap-0 with explicit px-3 + border-l
                 on inner tier columns to draw a muted-grey divider down
                 the center of each gap. Total inter-tier breathing room
                 stays at 24px (12 + border + 12), with the line living
                 dead center. Criterion-line gap-3 → gap-[11px] (~10%
                 tighter); criterion name text-xs → text-[12.5px] for
                 the +0.5px bump. */}
            <div className="grid gap-0 p-6 md:grid-cols-3">
              {([1, 2, 3] as const).map((t, idx) => (
                <div
                  key={t}
                  className={cn(
                    "min-w-0",
                    idx === 0 && "pr-3",
                    idx === 1 && "px-3 border-l border-border/40",
                    idx === 2 && "pl-3 border-l border-border/40",
                  )}
                >
                  <div className="mb-2 flex items-center justify-between">
                    <span className={cn("pill pill-sm", TIER_META[t].token)}>
                      {TIER_META[t].label}
                    </span>
                    <span className="label-form tabular-nums">
                      {grouped[t].reduce((s, c) => s + (c.weight ?? 0), 0)} pts
                    </span>
                  </div>
                  <ul className="space-y-1.5">
                    {grouped[t].length === 0 && <li className="text-xs text-muted-foreground">—</li>}
                    {grouped[t].map((c) => {
                      const got = scoresByCriterion[c.name] ?? 0;
                      return (
                        <li key={c.name} className="flex items-center justify-between gap-[11px] text-xs">
                          <span className="truncate text-[12.5px] text-muted-foreground">{c.name}</span>
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
          </section>
        </div>
      </div>
    </div>
  );
}
