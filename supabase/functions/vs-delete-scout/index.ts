// vs-delete-scout (Phase 5.12.6)
//
// Synchronous scout delete with storage-file cleanup. Replaces the pre-5.12.6
// direct `DELETE FROM vs_scouts WHERE id = $1` in `ScoutIndex.tsx`'s
// confirmDelete handler, which left brief PDFs, sourcing-sheet uploads, and
// vs_venue_photos storage objects orphaned (FK CASCADE handled the DB rows
// but never the storage buckets).
//
// Order (load-bearing): enumerate paths -> DB DELETE -> storage cleanup.
// Cleanup-first was rejected (a storage-cleanup failure followed by a
// successful DB DELETE leaves a half-deleted scout pointing at missing
// paths; producer sees a broken state). DB-first means partial storage
// failures degrade to pure orphans with no DB references -- the strictly
// safer degraded state and a direct match for today's everything-orphans
// behavior.
//
// Auth posture: verify_jwt = true. No extra scout-ownership gate because
// vs_* RLS is open-authenticated (any authenticated user can already delete
// any scout via direct PostgREST today); the gateway check + 404 on missing
// scout is sufficient. Counter-example to vs-research-single-venue's
// three-gate posture (Phase 5.12.7): that function accepts a (scout_id,
// venue_id) pair across an entity boundary and needed gates against
// cross-scout poisoning. This function takes only scout_id; there is no
// cross-entity surface to poison.
//
// Storage cleanup is best-effort: per-bucket `.remove()` errors are
// collected into the response payload but do NOT abort the function. Once
// the DB row is gone, storage orphans are an acceptable degraded outcome
// (matches the pre-5.12.6 behavior where ALL files orphaned). The frontend
// surfaces a destructive-variant toast on partial failure so the producer
// knows files may need manual cleanup, but the delete itself succeeded.
//
// Drive deck files (vs_scouts.generated_decks[*].deck_id) are NOT removed
// by design (per CHECKPOINT 2026-05-23 + Jimmie 2026-05-24): producers
// retain deck history outside the app after scout deletion. Not a deferred
// carry-forward.
//
// HQ `venues` rows referenced via vs_candidate_venues.linked_venue_id are
// NOT touched: the FK is ON DELETE SET NULL on the HQ side, so cascading
// the candidate venue (via vs_scouts cascade) leaves HQ venues intact.
//
// Service-role posture caveat: this function bypasses vs_* and
// storage.objects RLS. Pre-5.12.6 behavior used a direct PostgREST DELETE
// constrained by `authenticated` role policies on vs_scouts; today those
// policies are open-authenticated (any auth user can delete any scout),
// so the practical authorization surface is unchanged. If `vs_scouts`
// RLS is ever tightened (e.g. owner-only delete), this function must be
// tightened in the same change so the gate is not silently subverted.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Per-bucket batch size for storage.remove(). Storage admin API caps total
// path-list size per request; 100 is well under the limit and keeps a slow
// bucket from stalling the whole cleanup behind one giant call.
const REMOVE_CHUNK_SIZE = 100;

// PostgREST `.in(col, list)` serializes the full list into the request URL
// (`?col=in.(uuid1,uuid2,...)`). At 36 chars + 1 separator per UUID, 200
// values lands around 7.4KB, well under the conservative 8KB URL ceiling.
// Sourcing-sheet parsing can produce hundreds of candidate venues per
// scout (vs-parse-sheet inserts one row per parsed sheet line, no cap),
// so the photo enumeration MUST page candidate ids in bounded chunks.
const POSTGREST_IN_CHUNK = 200;

// PostgREST caps a single SELECT response at `db-max-rows` (Supabase
// default 1000). The candidate-id and photo SELECTs MUST page through
// the full set or we'd undercount storage paths AND silently leak files
// after the DB DELETE cascades the now-unreachable rows. We page on
// .order('id').range(...) until a short page is returned. PAGE_SIZE
// stays under db-max-rows so a single page is always complete.
const PAGE_SIZE = 1000;

type StorageError = { bucket: string; path: string; message: string };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ ok: false, error: "Method not allowed" }, 405);
  }

  let body: { scout_id?: string };
  try {
    body = (await req.json()) as { scout_id?: string };
  } catch {
    return jsonResponse({ ok: false, error: "Invalid JSON body" }, 400);
  }

  const scout_id = (body.scout_id ?? "").trim();
  if (!UUID_RE.test(scout_id)) {
    return jsonResponse({ ok: false, error: "scout_id must be a UUID" }, 400);
  }

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const t0 = Date.now();

  // 1. Enumerate paths. Read-only; fast; runs before any destructive op so
  //    a SELECT failure here leaves the scout untouched.
  const { data: scout, error: scoutErr } = await sb
    .from("vs_scouts")
    .select("id, event_name, brief_data, sheet_storage_path")
    .eq("id", scout_id)
    .maybeSingle();
  if (scoutErr) {
    return jsonResponse(
      { ok: false, error: "scout_lookup_failed", message: scoutErr.message },
      500,
    );
  }
  if (!scout) {
    return jsonResponse({ ok: false, error: "scout_not_found" }, 404);
  }

  const briefData = scout.brief_data as Record<string, unknown> | null;
  const uploadedRaw = briefData?.uploaded_files;
  const briefPaths: string[] = Array.isArray(uploadedRaw)
    ? (uploadedRaw as unknown[]).filter((p): p is string =>
        typeof p === "string" && p.length > 0,
      )
    : [];
  const sheetPath: string | null =
    typeof scout.sheet_storage_path === "string" &&
    scout.sheet_storage_path.length > 0
      ? scout.sheet_storage_path
      : null;

  // Two-query pattern (matches vs-generate-deck/index.ts:771-776): pull
  // candidate-venue ids first, then SELECT photos with `.in(...)`. A scout
  // can have candidate venues with zero photos, so `candidateIds.length`
  // is the authoritative venue count for the success-toast summary; the
  // photo SELECT only fires when there is at least one candidate.
  //
  // Both queries page through PostgREST's db-max-rows cap on .order('id')
  // .range(from, to): a scout with > PAGE_SIZE candidates (or > PAGE_SIZE
  // photos in a single .in() chunk) would otherwise truncate silently and
  // leave the post-DELETE storage objects orphaned without entering the
  // storage_errors accounting.
  const candidateIds: string[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data: candidates, error: candidatesErr } = await sb
      .from("vs_candidate_venues")
      .select("id")
      .eq("scout_id", scout_id)
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (candidatesErr) {
      return jsonResponse(
        {
          ok: false,
          error: "candidate_lookup_failed",
          message: candidatesErr.message,
        },
        500,
      );
    }
    const page = candidates ?? [];
    for (const c of page) {
      const id = (c as { id?: unknown }).id;
      if (typeof id === "string") candidateIds.push(id);
    }
    if (page.length < PAGE_SIZE) break;
  }

  const photoPaths: string[] = [];
  for (let i = 0; i < candidateIds.length; i += POSTGREST_IN_CHUNK) {
    const idChunk = candidateIds.slice(i, i + POSTGREST_IN_CHUNK);
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data: photos, error: photosErr } = await sb
        .from("vs_venue_photos")
        .select("storage_path")
        .in("candidate_venue_id", idChunk)
        .order("storage_path", { ascending: true })
        .range(from, from + PAGE_SIZE - 1);
      if (photosErr) {
        return jsonResponse(
          {
            ok: false,
            error: "photo_lookup_failed",
            message: photosErr.message,
          },
          500,
        );
      }
      const page = photos ?? [];
      for (const p of page) {
        const path = (p as { storage_path?: unknown }).storage_path;
        if (typeof path === "string" && path.length > 0) photoPaths.push(path);
      }
      if (page.length < PAGE_SIZE) break;
    }
  }

  // 2. DB DELETE. Cascades to vs_sourcing_rounds, vs_candidate_venues, and
  //    vs_venue_photos rows. Storage objects orphan; step 3 removes them.
  const { error: delErr } = await sb
    .from("vs_scouts")
    .delete()
    .eq("id", scout_id);
  if (delErr) {
    return jsonResponse(
      { ok: false, error: "db_delete_failed", message: delErr.message },
      500,
    );
  }

  // 3. Storage cleanup. Errors collected, NOT thrown; the scout is already
  //    gone, so partial storage failures degrade to orphans rather than
  //    rolling anything back.
  const storage_errors: StorageError[] = [];
  const counts = {
    candidate_venues: candidateIds.length,
    briefs_removed: 0,
    briefs_failed: 0,
    sheets_removed: 0,
    sheets_failed: 0,
    photos_removed: 0,
    photos_failed: 0,
  };

  async function removeFromBucket(
    bucket: string,
    paths: string[],
  ): Promise<{ removed: number; failed: number }> {
    let removed = 0;
    let failed = 0;
    for (let i = 0; i < paths.length; i += REMOVE_CHUNK_SIZE) {
      const chunk = paths.slice(i, i + REMOVE_CHUNK_SIZE);
      const { data, error } = await sb.storage.from(bucket).remove(chunk);
      if (error) {
        failed += chunk.length;
        storage_errors.push({
          bucket,
          path: chunk[0],
          message: error.message,
        });
        continue;
      }
      // Supabase storage `remove()` returns `data` as the array of objects
      // actually removed. When a path in the chunk did not exist (or was
      // silently skipped server-side) `error` is null but `data.length`
      // is short. Count the gap as failed so the accounting identity
      // (`enumerated === removed + failed`) holds.
      const removedThisChunk = (data ?? []).length;
      removed += removedThisChunk;
      const missingThisChunk = chunk.length - removedThisChunk;
      if (missingThisChunk > 0) {
        failed += missingThisChunk;
        storage_errors.push({
          bucket,
          path: chunk[0],
          message: `${missingThisChunk} path(s) in this chunk returned no removal record`,
        });
      }
    }
    return { removed, failed };
  }

  if (briefPaths.length > 0) {
    const r = await removeFromBucket("briefs", briefPaths);
    counts.briefs_removed = r.removed;
    counts.briefs_failed = r.failed;
  }
  if (sheetPath) {
    const r = await removeFromBucket("sourcing_sheets", [sheetPath]);
    counts.sheets_removed = r.removed;
    counts.sheets_failed = r.failed;
  }
  if (photoPaths.length > 0) {
    const r = await removeFromBucket("vs_venue_photos", photoPaths);
    counts.photos_removed = r.removed;
    counts.photos_failed = r.failed;
  }

  const wall = Date.now() - t0;
  console.log(
    `[vsDeleteScout] scout=${scout_id} candidates=${counts.candidate_venues} briefs=${counts.briefs_removed}/${counts.briefs_failed} sheets=${counts.sheets_removed}/${counts.sheets_failed} photos=${counts.photos_removed}/${counts.photos_failed} wall=${wall}ms ${storage_errors.length > 0 ? "outcome=partial" : "outcome=ok"}`,
  );

  return jsonResponse({
    ok: true,
    scout_id,
    event_name: scout.event_name,
    counts,
    ...(storage_errors.length > 0 ? { storage_errors } : {}),
  });
});
