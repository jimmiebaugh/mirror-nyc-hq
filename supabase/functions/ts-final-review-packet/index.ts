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

// deno-lint-ignore no-explicit-any
function fmtErr(e: any): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object") {
    if (typeof e.message === "string") {
      const parts = [e.message];
      if (e.code) parts.push(`(code ${e.code})`);
      if (e.details) parts.push(`details: ${e.details}`);
      if (e.hint) parts.push(`hint: ${e.hint}`);
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
    // deno-lint-ignore no-explicit-any
    const rankings: any[] = Array.isArray(fr.final_rankings) ? fr.final_rankings : [];
    if (!rankings.length) throw new Error("Final review has no rankings");

    const { data: role } = await supabase.from("ts_roles").select("*").eq("id", fr.role_id).maybeSingle();
    if (!role) throw new Error("Role not found");

    const candIds = rankings.map((r) => r.candidate_id);
    const { data: cands } = await supabase
      .from("ts_candidates")
      .select("id,name,email,location,applied_date,status,score,recruiter_overview,portfolio_path_or_url,detected_links")
      .in("id", candIds);
    // deno-lint-ignore no-explicit-any
    const candMap: Record<string, any> = {};
    // deno-lint-ignore no-explicit-any
    (cands ?? []).forEach((c: any) => { candMap[c.id] = c; });

    // deno-lint-ignore no-explicit-any
    const enriched = rankings.map((r: any) => {
      const c = candMap[r.candidate_id] ?? {};
      // recruiter_note may be array (Phase 3.6.6+) or legacy string. Flatten
      // to a single newline-joined bullet block for the packet's
      // drawWriteupCard helper (which renders one prose block).
      const rn = Array.isArray(r.recruiter_note)
        ? r.recruiter_note.filter(Boolean).map((s: string) => `• ${s}`).join("\n")
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
    // deno-lint-ignore no-explicit-any
    }).sort((a: any, b: any) => (a.final_rank ?? 9999) - (b.final_rank ?? 9999));

    // deno-lint-ignore no-explicit-any
    const topRecs = enriched.filter((c: any) => c.final_tier === "top_recommendation");
    // deno-lint-ignore no-explicit-any
    const strong = enriched.filter((c: any) => c.final_tier === "strong_consideration");
    // deno-lint-ignore no-explicit-any
    const backup = enriched.filter((c: any) => c.final_tier === "backup");
    // deno-lint-ignore no-explicit-any
    const notRec = enriched.filter((c: any) => c.final_tier === "not_recommended");

    // Per-candidate pages: include all when requested, else top-N + fast-tracks.
    const topNList = include_all ? enriched : enriched.slice(0, top_n);
    // deno-lint-ignore no-explicit-any
    const fastTracks = include_fast_track ? enriched.filter((c: any) => c.status === "fast_track") : [];
    // deno-lint-ignore no-explicit-any
    const candPagesMap = new Map<string, any>();
    // deno-lint-ignore no-explicit-any
    [...topNList, ...fastTracks].forEach((c: any) => candPagesMap.set(c.candidate_id, c));
    // deno-lint-ignore no-explicit-any
    const candidatesForPages = Array.from(candPagesMap.values())
      // deno-lint-ignore no-explicit-any
      .sort((a: any, b: any) => (a.final_rank ?? 9999) - (b.final_rank ?? 9999));

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
      // deno-lint-ignore no-explicit-any
      : enriched.map((c: any) => [
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
      // deno-lint-ignore no-explicit-any
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
      // deno-lint-ignore no-explicit-any
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
      // deno-lint-ignore no-explicit-any
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
      // deno-lint-ignore no-explicit-any
      ], notRec.map((c: any) => [
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
      // deno-lint-ignore no-explicit-any
      (attRows ?? []).forEach((a: any) => {
        attsByCand[a.candidate_id] = attsByCand[a.candidate_id] ?? [];
        attsByCand[a.candidate_id].push(a as StorageAttachment);
      });

      for (const c of candidatesForPages) {
        addCandidateTitlePage(ctx, {
          candidate: {
            id: c.candidate_id, name: c.name, email: c.email,
            applied_date: c.applied_date, location: c.location,
            portfolio_path_or_url: c.portfolio_path_or_url,
            detected_links: c.detected_links,
          },
          attachments: attsByCand[c.candidate_id] ?? [],
          rank: c.final_rank,
          tier: c.final_tier,
          tierLabel: TIER_LABEL[c.final_tier] ?? c.final_tier,
          totalScore: c.total_score,
          roleTitle: role.title ?? "Role",
          contextLine: "Final Review · Mirror NYC",
        });
        await mergePdfAttachments(ctx.doc, supabase, attsByCand[c.candidate_id] ?? []);
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
        subject: `Mirror · ${role.title ?? "Role"} · Final Review Packet`,
        bodyText: `Hi ${hm.full_name?.split(/\s+/)[0] ?? "there"},\n\nThe final review packet for ${role.title ?? "the role"} is ready.\n\n${enriched.length} candidates analyzed across the master pool.\n\n— Mirror NYC HQ`,
        packetUrl: emailUrl,
        attachmentFilename: friendlyName,
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
