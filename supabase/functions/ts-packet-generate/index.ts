// ts-packet-generate — round-scoped candidate review packet PDF.
//
// Phase 3.6.1: rewritten for pure pdf-lib rendering (no CloudConvert).
// Visual treatment is simpler than the source — Helvetica throughout, no
// HTML→PDF conversion — but ships reliably inside the Edge Function runtime.
//
// Pulls from ts_pull_rounds + ts_roles + ts_candidates. Reads attachment
// bytes from candidate_attachments Storage bucket (Phase 3.4 path). Emails
// the role's hiring manager from jobs@mirrornyc.com via the service
// account's gmail.send scope.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireInternalOrUserAuth } from "../_shared/internalAuth.ts";
import {
  C_CORAL,
  C_TIER1,
  C_TIER2,
  C_TIER3,
  StorageAttachment,
  addCandidateTitlePage,
  addCoverPage,
  addSectionDivider,
  createPacketCtx,
  drawSectionSub,
  drawSectionTitle,
  drawTable,
  drawWriteupCard,
  fmtDateLong,
  fmtDateShort,
  mergePdfAttachments,
  newContentPage,
  sendPacketEmail,
  slug,
  tierColor,
  uploadPacketAndSign,
} from "../_shared/packetRender.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-secret",
};

const sb = () => createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

function fmtErr(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object") {
    const o = e as { message?: unknown; code?: unknown; details?: unknown; hint?: unknown };
    if (typeof o.message === "string") {
      const parts = [o.message];
      if (o.code) parts.push(`(code ${o.code})`);
      if (o.details) parts.push(`details: ${o.details}`);
      if (o.hint) parts.push(`hint: ${o.hint}`);
      return parts.join(" ");
    }
    try { return JSON.stringify(e).slice(0, 500); } catch { return String(e); }
  }
  return String(e);
}

// ============================================================================
// Helpers — round-packet specific
// ============================================================================

function isNYC(loc: string | null | undefined): boolean {
  if (!loc) return true;
  const l = loc.toLowerCase();
  return ["nyc", "new york", "brooklyn", "manhattan", "queens", "bronx", "staten island"]
    .some((k) => l.includes(k));
}

type ScorecardEntry = { criterion: string; tier: number; weight: number; max_points?: number };

// Narrow row shape for the partial ts_candidates projection this function
// selects (see the `.select(...)` below). detected_links is typed to match
// what addCandidateTitlePage consumes. manually_reviewed is NOT selected, so
// it is optional/undefined at runtime and used only in the AI-rejected count.
interface PacketCandidateRow {
  id: string;
  name: string | null;
  email: string | null;
  location: string | null;
  applied_date: string | null;
  status: string;
  score: number | null;
  recruiter_overview: string | null;
  top_strengths: unknown;
  key_gaps: unknown;
  score_breakdown: unknown;
  portfolio_path_or_url: string | null;
  detected_links: { url: string; type: string }[] | null;
  tier: string | null;
  manually_reviewed?: boolean;
}

// Enriched candidate carried through ranking/rendering.
interface EnrichedCandidate extends PacketCandidateRow {
  total_score: number;
  top_strength_short: string | null;
  key_gap_short: string | null;
}

function computeTierMaxes(scorecard: ScorecardEntry[]) {
  const tierMax = (t: number) => scorecard.filter((c) => c.tier === t).reduce((s, c) => s + (Number(c.weight) || 0), 0);
  return { t1: tierMax(1), t2: tierMax(2), t3: tierMax(3) };
}

function classifyForPacket(c: { status: string }): "fast_track" | "borderline" | "other_recommended" | "not_recommended" {
  if (c.status === "fast_track") return "fast_track";
  if (c.status === "reject" || c.status === "auto_rejected") return "not_recommended";
  return "other_recommended";
}

function classificationLabel(t: string): string {
  if (t === "fast_track") return "Fast-Track";
  if (t === "borderline") return "Borderline";
  if (t === "other_recommended") return "Other Recommended";
  if (t === "not_recommended") return "Not Recommended";
  return t;
}

// ============================================================================
// Main
// ============================================================================

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const authFail = await requireInternalOrUserAuth(req);
  if (authFail) {
    return new Response(authFail.body, {
      status: authFail.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const { pull_round_id, top_n = 15, include_fast_track = true } = await req.json();
    if (!pull_round_id) {
      return new Response(JSON.stringify({ error: "pull_round_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = sb();
    const { data: round } = await supabase.from("ts_pull_rounds").select("*").eq("id", pull_round_id).maybeSingle();
    if (!round) throw new Error("Pull round not found");
    const { data: role } = await supabase.from("ts_roles").select("*").eq("id", round.role_id).maybeSingle();
    if (!role) throw new Error("Role not found");

    const { data: cands } = await supabase
      .from("ts_candidates")
      .select("id,name,email,location,applied_date,status,score,recruiter_overview,top_strengths,key_gaps,score_breakdown,portfolio_path_or_url,detected_links,tier")
      .eq("pull_round_id", pull_round_id);
    const candList = (cands ?? []) as PacketCandidateRow[];

    // Enrich + sort.
    const enriched: EnrichedCandidate[] = candList.map((c) => ({
      ...c,
      total_score: Number(c.score ?? 0),
      top_strength_short: Array.isArray(c.top_strengths) ? (c.top_strengths[0] as string | null) : null,
      key_gap_short: Array.isArray(c.key_gaps) ? (c.key_gaps[0] as string | null) : null,
    }));

    const scorecard: ScorecardEntry[] = Array.isArray(role.scorecard) ? (role.scorecard as ScorecardEntry[]) : [];
    const { t1: t1Max, t2: t2Max, t3: t3Max } = computeTierMaxes(scorecard);
    // Phase 3.7.6.7: default 12 → 10 to match updated COMPETITOR_BONUS_POINTS
    // constant. Roles still carry their own bonus_points in jsonb so older
    // roles persist whatever value they were created with.
    const competitorBonus = role.competitor_bonus as { bonus_points?: number } | null;
    const bonusMax = Number(competitorBonus?.bonus_points ?? 10);
    const totalMax = (t1Max || 53) + (t2Max || 42) + (t3Max || 5) + bonusMax;

    const sorted = [...enriched].sort((a, b) => b.total_score - a.total_score);
    const isRej = (s: string) => s === "reject" || s === "auto_rejected";
    const nonRejected = sorted.filter((c) => !isRej(c.status));
    const topN = nonRejected.slice(0, top_n);
    const fastTracks = include_fast_track ? sorted.filter((c) => c.status === "fast_track") : [];
    const topMap = new Map<string, EnrichedCandidate>();
    [...topN, ...fastTracks].forEach((c) => topMap.set(c.id, c));
    const topCandidates = Array.from(topMap.values()).sort((a, b) => b.total_score - a.total_score);

    const pulled = candList.length;
    const inPool = candList.filter((c) => ["interview", "fast_track", "consider"].includes(c.status)).length;
    // Phase 3.7.2.1: AI-rejected count = status='reject' AND
    // manually_reviewed=false (the AI's call, no human confirmation yet).
    // Legacy 'auto_rejected' still counted for any rows that escaped the
    // backfill.
    const autoRejected = candList.filter(
      (c) =>
        c.status === "auto_rejected" ||
        (c.status === "reject" && !c.manually_reviewed),
    ).length;
    const fastTrackCount = candList.filter((c) => c.status === "fast_track").length;

    const reportDate = new Date(round.completed_at ?? round.started_at ?? Date.now());
    const headerText = `Mirror NYC · ${role.title ?? "Role"} · R${round.round_number ?? "?"}`;

    // 1-based rank by sorted order
    const rankOf: Record<string, number> = {};
    sorted.forEach((c, i) => { rankOf[c.id] = i + 1; });

    // ============================================================
    // Build packet
    // ============================================================
    const ctx = await createPacketCtx(headerText);

    addCoverPage(ctx, {
      eyebrow: "Candidate Evaluation Report",
      title: role.title ?? "Untitled Role",
      subtitleA: `Round ${round.round_number ?? 0}`,
      subtitleB: "Review Packet",
      date: reportDate,
      stats: [
        { label: "Pulled", value: pulled },
        { label: "In Pool", value: inPool, accent: "coral" },
        { label: "Auto-Rejected", value: autoRejected, accent: "error" },
        { label: "Fast-Track", value: fastTrackCount, accent: "success" },
      ],
      footer: "STRATEGY / DESIGN / PRODUCTION",
    });

    // Matrix page (NYC-only top 15)
    const matrixCands = nonRejected.filter((c) => isNYC(c.location)).slice(0, 15);
    const fastTrackIds = new Set(sorted.filter((c) => c.status === "fast_track").map((c) => c.id));

    newContentPage(ctx);
    drawSectionTitle(ctx, "Top Candidate", "Comparison Matrix");
    drawSectionSub(ctx, "Sorted by total score, highest to lowest. NYC-area candidates only.");

    drawTable(ctx, [
      { label: "#", width: 28, align: "center" },
      { label: "Candidate", width: 120 },
      { label: "Score", width: 60, align: "right" },
      { label: "Top Strength", width: 162 },
      { label: "Key Gap", width: 142 },
    ], matrixCands.length === 0
      ? [["", "No NYC-area candidates in this round.", "", "", ""]]
      : matrixCands.map((c, i) => [
        String(i + 1),
        { text: c.name ?? c.email ?? "", bold: true,
          color: fastTrackIds.has(c.id) ? C_CORAL : undefined },
        { text: `${c.total_score}/${totalMax}`, bold: true, color: C_CORAL },
        c.top_strength_short ?? "",
        c.key_gap_short ?? "",
      ]),
    );

    // Writeup pages: Fast-Track / Other (no Borderline heuristic in 3.6.1
    // for simplicity — the AI's tier guidance covers this distinction in
    // the final review packet; round packet just splits fast_track vs
    // consider/interview).
    const fastTrackCands = sorted.filter((c) => c.status === "fast_track");
    const otherRecommended = sorted.filter((c) =>
      (c.status === "consider" || c.status === "interview") && c.status !== "fast_track"
    );

    if (fastTrackCands.length) {
      newContentPage(ctx);
      drawSectionTitle(ctx, "Fast-Track", "Candidates");
      drawSectionSub(ctx, "Contact for an immediate conversation.");
      for (const c of fastTrackCands) {
        drawWriteupCard(ctx, {
          name: c.name ?? c.email ?? "Candidate",
          meta: [`Rank #${rankOf[c.id]}`, c.location].filter(Boolean).join(" · "),
          scoreLine: `${c.total_score} / ${totalMax}`,
          body: c.recruiter_overview ?? "—",
          accent: C_CORAL,
        });
      }
    }
    if (otherRecommended.length) {
      newContentPage(ctx);
      drawSectionTitle(ctx, "Other", "Recommended");
      drawSectionSub(ctx, "Solid candidates worth keeping in the pipeline.");
      for (const c of otherRecommended) {
        drawWriteupCard(ctx, {
          name: c.name ?? c.email ?? "Candidate",
          meta: [`Rank #${rankOf[c.id]}`, c.location].filter(Boolean).join(" · "),
          scoreLine: `${c.total_score} / ${totalMax}`,
          body: c.recruiter_overview ?? "—",
          accent: C_TIER2,
        });
      }
    }

    // Per-candidate title pages + attachments
    if (topCandidates.length) {
      addSectionDivider(ctx, {
        title: "CANDIDATE\nPACKETS",
        subtitle: "Full submitted materials for each top candidate, in ranked order. Application emails, cover letters, resumes, and portfolio links — as provided.",
        tag: `R${round.round_number ?? 0} · ${fmtDateShort(reportDate)}`,
      });

      const candIds = topCandidates.map((c) => c.id);
      const { data: attRows } = await supabase
        .from("ts_candidate_attachments")
        .select("id,candidate_id,attachment_type,file_name,file_path,file_size_bytes")
        .in("candidate_id", candIds);
      const attsByCand: Record<string, StorageAttachment[]> = {};
      ((attRows ?? []) as StorageAttachment[]).forEach((a) => {
        attsByCand[a.candidate_id] = attsByCand[a.candidate_id] ?? [];
        attsByCand[a.candidate_id].push(a);
      });

      for (const c of topCandidates) {
        const tier = classifyForPacket(c);
        addCandidateTitlePage(ctx, {
          candidate: {
            id: c.id, name: c.name, email: c.email,
            applied_date: c.applied_date, location: c.location,
            portfolio_path_or_url: c.portfolio_path_or_url,
            detected_links: c.detected_links,
          },
          attachments: attsByCand[c.id] ?? [],
          rank: rankOf[c.id],
          tier,
          tierLabel: classificationLabel(tier),
          totalScore: c.total_score,
          totalMax,
          roleTitle: role.title ?? "Role",
          contextLine: `Round ${round.round_number ?? 0} · Mirror NYC`,
        });
        await mergePdfAttachments(ctx.doc, supabase, attsByCand[c.id] ?? []);
      }
    }

    // ============================================================
    // Upload + email
    // ============================================================
    const { path, signedUrl, emailUrl, bytes, friendlyName } = await uploadPacketAndSign(supabase, ctx.doc, {
      pathPrefix: `${round.role_id}/round/${pull_round_id}`,
      roleSlug: slug(role.title),
      friendlyKind: `${role.title ?? "Role"} | R${round.round_number ?? "?"} Candidate Review Packet`,
      safeKind: `r${round.round_number ?? "0"}-candidate-review-packet`,
    });

    await supabase.from("ts_pull_rounds").update({
      packet_url: path,
      packet_top_n: top_n,
      packet_include_fast_track: include_fast_track,
      packet_generated_at: new Date().toISOString(),
    }).eq("id", pull_round_id);

    const { data: hm } = role.hiring_manager_id
      ? await supabase.from("users").select("email,full_name").eq("id", role.hiring_manager_id).maybeSingle()
      : { data: null };
    if (hm?.email) {
      await sendPacketEmail({
        to: hm.email,
        subject: `Mirror · ${role.title ?? "Role"} · R${round.round_number ?? "?"} Candidate Review Packet`,
        bodyText: `Hi ${hm.full_name?.split(/\s+/)[0] ?? "there"},\n\nThe candidate review packet for Round ${round.round_number ?? "?"} of ${role.title ?? "the role"} is ready.\n\n${pulled} candidates pulled, ${inPool} in pool, ${fastTrackCount} fast-tracked.\n\n— Mirror NYC HQ`,
        packetUrl: emailUrl,
        attachmentFilename: friendlyName,
      });
    }

    return new Response(JSON.stringify({ url: signedUrl, path, bytes }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = fmtErr(e);
    console.error("[ts-packet-generate] error:", msg, e);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
