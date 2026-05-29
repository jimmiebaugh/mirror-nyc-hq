// ts-final-review-packet — review-scoped packet PDF.
//
// Phase 3.6.1: rewritten for pure pdf-lib rendering (no CloudConvert).
// Pulls from ts_final_reviews + ts_roles + ts_candidates + ts_evaluations.
// Reads attachments from candidate_attachments Storage. Emails the role's
// hiring manager via the Gmail service account.
//
// Final rankings shape per Phase 3.6:
//   {candidate_id, final_rank, final_tier, rationale, recruiter_note}
// final_overview was removed in Phase 3.6.1 — see docs/decisions.md.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireInternalOrAdminUser } from "../_shared/internalAuth.ts";
import {
  C_CORAL,
  C_TIER1,
  C_TIER2,
  C_TIER3,
  StorageAttachment,
  addCandidateTitlePage,
  addCoverLetterEmailPages,
  addCoverPage,
  addSectionDivider,
  createPacketCtx,
  drawParagraph,
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

const TIER_LABEL: Record<string, string> = {
  top_recommendation: "Top Recommendation",
  strong_consideration: "Strong Consideration",
  backup: "Backup",
  not_recommended: "Not Recommended",
};

// Final-review ranking entry as stored in ts_final_reviews.final_rankings
// (Json). Shape per Phase 3.6 header. recruiter_note may be an array
// (Phase 3.6.6+) or a legacy string.
interface RankingEntry {
  candidate_id: string;
  final_rank?: number | null;
  final_tier?: string | null;
  rationale?: string | null;
  recruiter_note?: string[] | string | null;
}

// Narrow row shape for the partial ts_candidates projection this function
// selects (see the `.select(...)` below). detected_links is typed to match
// what addCandidateTitlePage consumes.
interface FinalCandidateRow {
  id: string;
  name: string | null;
  email: string | null;
  location: string | null;
  applied_date: string | null;
  status: string;
  score: number | null;
  recruiter_overview: string | null;
  portfolio_path_or_url: string | null;
  detected_links: { url: string; type: string }[] | null;
  email_body_text: string | null;
}

// Candidate row merged with its ranking entry plus derived render fields.
// Spread from a possibly-empty candidate map, so the row fields are optional.
interface EnrichedFinalCandidate extends Partial<FinalCandidateRow> {
  candidate_id: string;
  final_rank?: number | null;
  final_tier: string;
  rationale: string;
  recruiter_note: string | null;
  total_score: number | null;
  portfolio_url: string | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const authFail = await requireInternalOrAdminUser(req);
  if (authFail) {
    return new Response(authFail.body, {
      status: authFail.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const { final_review_id, top_n = 10, include_fast_track = true, include_all = true } = await req.json();
    if (!final_review_id) {
      return new Response(JSON.stringify({ error: "final_review_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = sb();
    const { data: fr } = await supabase.from("ts_final_reviews").select("*").eq("id", final_review_id).maybeSingle();
    if (!fr) throw new Error("Final review not found");
    if (fr.status !== "complete") throw new Error("Final review is not complete yet");
    const rankings: RankingEntry[] = Array.isArray(fr.final_rankings)
      ? (fr.final_rankings as unknown as RankingEntry[])
      : [];
    if (!rankings.length) throw new Error("Final review has no rankings");

    const { data: role } = await supabase.from("ts_roles").select("*").eq("id", fr.role_id).maybeSingle();
    if (!role) throw new Error("Role not found");

    const candIds = rankings.map((r) => r.candidate_id);
    const { data: cands } = await supabase
      .from("ts_candidates")
      .select("id,name,email,location,applied_date,status,score,recruiter_overview,portfolio_path_or_url,detected_links,email_body_text")
      .in("id", candIds);
    const candMap: Record<string, FinalCandidateRow> = {};
    ((cands ?? []) as FinalCandidateRow[]).forEach((c) => { candMap[c.id] = c; });

    const enriched: EnrichedFinalCandidate[] = rankings.map((r) => {
      const c = candMap[r.candidate_id] ?? {} as Partial<FinalCandidateRow>;
      // recruiter_note may be array (Phase 3.6.6+) or legacy string. Flatten
      // to a single newline-joined bullet block for the packet's
      // drawWriteupCard helper (which renders one prose block).
      const rn = Array.isArray(r.recruiter_note)
        ? r.recruiter_note.filter(Boolean).map((s) => `• ${s}`).join("\n")
        : typeof r.recruiter_note === "string" ? r.recruiter_note
          : "";
      return {
        ...c,
        candidate_id: r.candidate_id,
        final_rank: r.final_rank,
        final_tier: r.final_tier ?? "backup",
        rationale: r.rationale ?? "",
        recruiter_note: rn || null,
        total_score: c.score ?? null,
        portfolio_url: c.portfolio_path_or_url ?? null,
      };
    }).sort((a, b) => (a.final_rank ?? 9999) - (b.final_rank ?? 9999));

    const topRecs = enriched.filter((c) => c.final_tier === "top_recommendation");
    const strong = enriched.filter((c) => c.final_tier === "strong_consideration");
    const backup = enriched.filter((c) => c.final_tier === "backup");
    const notRec = enriched.filter((c) => c.final_tier === "not_recommended");

    // Per-candidate pages: include all when requested, else top-N + fast-tracks.
    const topNList = include_all ? enriched : enriched.slice(0, top_n);
    const fastTracks = include_fast_track ? enriched.filter((c) => c.status === "fast_track") : [];
    const candPagesMap = new Map<string, EnrichedFinalCandidate>();
    [...topNList, ...fastTracks].forEach((c) => candPagesMap.set(c.candidate_id, c));
    const candidatesForPages = Array.from(candPagesMap.values())
      .sort((a, b) => (a.final_rank ?? 9999) - (b.final_rank ?? 9999));

    const reportDate = new Date(fr.generated_at ?? Date.now());
    const headerText = `Mirror NYC · ${role.title ?? "Role"} · Final Review`;

    // ============================================================
    // Build packet
    // ============================================================
    const ctx = await createPacketCtx(headerText);

    addCoverPage(ctx, {
      eyebrow: "Final Review · Master Pool",
      title: role.title ?? "Untitled Role",
      subtitleA: "Final Review",
      subtitleB: "Master Pool Report",
      date: reportDate,
      stats: [
        { label: "Pool Size", value: enriched.length },
        { label: "Top Recs", value: topRecs.length, accent: "success" },
        { label: "Strong", value: strong.length, accent: "warn" },
        { label: "Backup", value: backup.length, accent: "muted" },
      ],
      footer: "STRATEGY / DESIGN / PRODUCTION",
    });

    // Pool Summary page
    newContentPage(ctx);
    drawSectionTitle(ctx, "Pool", "Summary");
    drawSectionSub(ctx, `Holistic analysis of the Master Pool · Generated ${fmtDateLong(reportDate)}`);
    drawParagraph(ctx, fr.pool_summary ?? "—", { size: 11, lineHeight: 16 });

    // Rankings table page
    newContentPage(ctx);
    drawSectionTitle(ctx, "Final Review", "Rankings");
    drawSectionSub(ctx, "All Master Pool candidates ranked. Per-round scores preserved.");

    drawTable(ctx, [
      { label: "Rank", width: 50, align: "center" },
      { label: "Candidate", width: 140 },
      { label: "Tier", width: 130 },
      { label: "Score", width: 50, align: "right" },
      { label: "Location", width: 142 },
    ], enriched.length === 0
      ? [["", "No candidates ranked.", "", "", ""]]
      : enriched.map((c) => [
        { text: String(c.final_rank ?? "—"), bold: true, color: C_CORAL },
        { text: c.name ?? c.email ?? "—", bold: true,
          color: c.final_tier === "top_recommendation" ? C_TIER3 : undefined },
        { text: TIER_LABEL[c.final_tier] ?? c.final_tier,
          color: tierColor(c.final_tier) },
        { text: c.total_score != null ? String(c.total_score) : "—", bold: true },
        c.location ?? "—",
      ]),
    );

    // Tier writeup pages
    if (topRecs.length) {
      newContentPage(ctx);
      drawSectionTitle(ctx, "Top", "Recommendations");
      drawSectionSub(ctx, "Hiring manager should prioritize for offer or final-round interviews.");
      for (const c of topRecs) {
        drawWriteupCard(ctx, {
          name: c.name ?? c.email ?? "Candidate",
          meta: [`Rank #${c.final_rank}`, TIER_LABEL[c.final_tier], c.location].filter(Boolean).join(" · "),
          scoreLine: c.total_score != null ? String(c.total_score) : undefined,
          body: c.rationale,
          recruiterNote: c.recruiter_note,
          accent: C_TIER3,
        });
      }
    }
    if (strong.length) {
      newContentPage(ctx);
      drawSectionTitle(ctx, "Strong", "Consideration");
      drawSectionSub(ctx, "Qualified candidates worth interviewing if top picks fall through.");
      for (const c of strong) {
        drawWriteupCard(ctx, {
          name: c.name ?? c.email ?? "Candidate",
          meta: [`Rank #${c.final_rank}`, TIER_LABEL[c.final_tier], c.location].filter(Boolean).join(" · "),
          scoreLine: c.total_score != null ? String(c.total_score) : undefined,
          body: c.rationale,
          recruiterNote: c.recruiter_note,
          accent: C_TIER2,
        });
      }
    }
    if (backup.length) {
      newContentPage(ctx);
      drawSectionTitle(ctx, "Backup");
      drawSectionSub(ctx, "Qualified but unlikely to be chosen unless circumstances change.");
      for (const c of backup) {
        drawWriteupCard(ctx, {
          name: c.name ?? c.email ?? "Candidate",
          meta: [`Rank #${c.final_rank}`, TIER_LABEL[c.final_tier], c.location].filter(Boolean).join(" · "),
          scoreLine: c.total_score != null ? String(c.total_score) : undefined,
          body: c.rationale,
          accent: undefined, // muted
        });
      }
    }
    if (notRec.length) {
      newContentPage(ctx);
      drawSectionTitle(ctx, "Not", "Recommended");
      drawSectionSub(ctx, "In the pool but should be moved to rejected on review.");
      drawTable(ctx, [
        { label: "Rank", width: 60, align: "center" },
        { label: "Name", width: 200 },
        { label: "Score", width: 60, align: "right" },
        { label: "Brief Reason", width: 192 },
      ], notRec.map((c) => [
        String(c.final_rank ?? "—"),
        c.name ?? c.email ?? "—",
        c.total_score != null ? String(c.total_score) : "—",
        ((c.rationale ?? "").split(/[.!?]/)[0] ?? "").slice(0, 160),
      ]));
    }

    // Per-candidate title pages + attachments
    if (candidatesForPages.length) {
      addSectionDivider(ctx, {
        title: "CANDIDATE\nPACKETS",
        subtitle: "Full submitted materials for top-ranked candidates. Application emails, cover letters, resumes, and portfolio links — as provided.",
        tag: `Final Review · ${fmtDateShort(reportDate)}`,
      });

      const cidArr = candidatesForPages.map((c) => c.candidate_id);
      const { data: attRows } = await supabase
        .from("ts_candidate_attachments")
        .select("id,candidate_id,attachment_type,file_name,file_path,file_size_bytes")
        .in("candidate_id", cidArr);
      const attsByCand: Record<string, StorageAttachment[]> = {};
      ((attRows ?? []) as StorageAttachment[]).forEach((a) => {
        attsByCand[a.candidate_id] = attsByCand[a.candidate_id] ?? [];
        attsByCand[a.candidate_id].push(a);
      });

      for (const c of candidatesForPages) {
        const candAtts = attsByCand[c.candidate_id] ?? [];
        const hasCoverLetterAtt = candAtts.some(
          (a) => a.attachment_type === "cover_letter" || /cover/i.test(a.file_name),
        );
        const emailBody = typeof c.email_body_text === "string" ? c.email_body_text.trim() : "";
        const useEmailFallback = !hasCoverLetterAtt && emailBody.length > 0;

        addCandidateTitlePage(ctx, {
          candidate: {
            id: c.candidate_id, name: c.name, email: c.email,
            applied_date: c.applied_date, location: c.location,
            portfolio_path_or_url: c.portfolio_path_or_url,
            detected_links: c.detected_links,
            // Title page uses this to decide between "(not submitted)" and
            // the "Cover Letter Email" listing.
            email_body_text: c.email_body_text ?? null,
          },
          attachments: candAtts,
          rank: c.final_rank,
          tier: c.final_tier,
          tierLabel: TIER_LABEL[c.final_tier] ?? c.final_tier,
          totalScore: c.total_score,
          roleTitle: role.title ?? "Role",
          contextLine: "Final Review · Mirror NYC",
        });

        // Phase 3.6.14: if no cover letter attachment, render the
        // application email body as a Cover Letter Email page sequence in
        // the slot the cover letter PDF would have occupied. mergePdf-
        // Attachments still runs afterward for resume + others.
        if (useEmailFallback) {
          addCoverLetterEmailPages(ctx, {
            candidateName: c.name,
            candidateEmail: c.email,
            appliedDate: c.applied_date,
            bodyText: emailBody,
          });
        }

        await mergePdfAttachments(ctx.doc, supabase, candAtts);
      }
    }

    // ============================================================
    // Upload + email
    // ============================================================
    const { path, signedUrl, emailUrl, bytes, friendlyName } = await uploadPacketAndSign(supabase, ctx.doc, {
      pathPrefix: `${fr.role_id}/final-review/${final_review_id}`,
      roleSlug: slug(role.title),
      friendlyKind: `${role.title ?? "Role"} | Final Review`,
      safeKind: "final-review",
    });

    await supabase.from("ts_final_reviews").update({
      packet_url: path,
      packet_top_n: top_n,
      packet_include_fast_track: include_fast_track,
      packet_generated_at: new Date().toISOString(),
    }).eq("id", final_review_id);

    const { data: hm } = role.hiring_manager_id
      ? await supabase.from("users").select("email,full_name").eq("id", role.hiring_manager_id).maybeSingle()
      : { data: null };
    if (hm?.email) {
      await sendPacketEmail({
        to: hm.email,
        subject: `[Mirror HQ] Final Review Packet | ${role.title ?? "Role"}`,
        bodyText: `Hi ${hm.full_name?.split(/\s+/)[0] ?? "there"},\n\nThe final review packet for ${role.title ?? "the role"} is ready.\n\n${enriched.length} candidates analyzed across the master pool.\n\n- Mirror NYC HQ`,
        packetUrl: emailUrl,
        attachmentFilename: friendlyName,
        downloadLinkLabel: "Download Final Review packet",
      });
    }

    return new Response(JSON.stringify({ url: signedUrl, path, bytes }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = fmtErr(e);
    console.error("[ts-final-review-packet] error:", msg, e);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
