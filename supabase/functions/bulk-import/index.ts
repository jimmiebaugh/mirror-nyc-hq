// bulk-import (Phase 5.9.1): shared cross-cutting bulk-import primitive.
//
// User-invoked synchronous; verify_jwt = true (default). The gateway
// JWT check covers the auth-required tier; the function then re-checks
// permission_role = 'admin' server-side as defense in depth on top of
// the AdminRoute gate (spec § 9).
//
// Handlers for project / vendor / venue plug in via the `handlers` map. Any
// other entity_type returns "Entity handler not registered" cleanly. (The
// 5.9.1 _smoke prover handler was removed in 5.9.5.)
//
// The project handler.commit() is a thin wrapper over the SECURITY DEFINER RPC
// bulk_import_commit_projects, which owns the whole atomic write INCLUDING the
// bulk_import_sessions audit row + the session activity_log row. When commit()
// returns a session_id, the edge function MUST skip its own session +
// activity_log inserts (the RPC already wrote both). Memory:
// feedback_postgrest_no_multi_statement_tx — only an in-DB transaction (the
// RPC) can roll back the cross-table write atomically.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { validateProjectImport } from "./_validators/project.ts";
import { validateVendorImport } from "./_validators/vendor.ts";
import { validateVenueImport } from "./_validators/venue.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

type Mode = "preview" | "commit" | "undo";

type ValidationError = {
  row_index: number;
  column: string;
  message: string;
};

type UnresolvedRef = {
  kind: string;
  raw_value: string;
  row_indices: number[];
};

type BulkImportRequest = {
  entity_type?: string;
  mode?: Mode;
  rows?: Record<string, unknown>[];
  queued_refs?: Record<string, Array<Record<string, unknown>>>;
  column_set?: string[];
  session_id?: string;
  dry_run?: boolean;
};

type ServiceClient = ReturnType<typeof createClient>;

type EntityHandlerResult = {
  created_ids: string[];
  created_refs: Record<string, number>;
  /** Optional. When set, the handler owned the bulk_import_sessions write
   *  inside its own transaction (the RPC), so the edge function MUST NOT
   *  double-insert the session row or the session activity_log row. */
  session_id?: string;
};

type EntityHandler = {
  entity_type: string;
  validate: (
    rows: Record<string, unknown>[],
    queued_refs: Record<string, Array<Record<string, unknown>>>,
  ) => { errors: ValidationError[]; unresolved: UnresolvedRef[] };
  commit: (
    rows: Record<string, unknown>[],
    queued_refs: Record<string, Array<Record<string, unknown>>>,
    sb: ServiceClient,
    actor_id: string,
    column_set: string[],
  ) => Promise<EntityHandlerResult>;
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// project handler: thin wrapper over the SECURITY DEFINER RPC. The RPC owns the
// session + activity_log writes, so commit() returns session_id and the edge
// function skips its own session write below.
const projectHandler: EntityHandler = {
  entity_type: "project",
  validate: (rows, queued_refs) => validateProjectImport(rows, queued_refs),
  commit: async (rows, queued_refs, sb, actor_id, column_set) => {
    const { data, error } = await sb.rpc("bulk_import_commit_projects", {
      payload: { actor_id, column_set, rows, queued_refs },
    });
    if (error) {
      throw new Error(`bulk_import_commit_projects failed: ${error.message}`);
    }
    const result = data as {
      ok?: boolean;
      session_id?: string;
      created_ids?: string[];
      created_refs?: Record<string, number>;
      error?: string;
    } | null;
    if (!result?.ok) {
      throw new Error(result?.error ?? "RPC returned ok=false without an error");
    }
    return {
      created_ids: result.created_ids ?? [],
      created_refs: result.created_refs ?? {},
      session_id: result.session_id,
    };
  },
};

// vendor handler: thin wrapper over the SECURITY DEFINER RPC bulk_import_commit_vendors.
// Same shape as projectHandler; the RPC owns the session + activity_log writes and
// returns session_id, so the edge function skips its own session write below.
const vendorHandler: EntityHandler = {
  entity_type: "vendor",
  validate: (rows, queued_refs) => validateVendorImport(rows, queued_refs),
  commit: async (rows, queued_refs, sb, actor_id, column_set) => {
    const { data, error } = await sb.rpc("bulk_import_commit_vendors", {
      payload: { actor_id, column_set, rows, queued_refs },
    });
    if (error) {
      throw new Error(`bulk_import_commit_vendors failed: ${error.message}`);
    }
    const result = data as {
      ok?: boolean;
      session_id?: string;
      created_ids?: string[];
      created_refs?: Record<string, number>;
      error?: string;
    } | null;
    if (!result?.ok) {
      throw new Error(result?.error ?? "RPC returned ok=false without an error");
    }
    return {
      created_ids: result.created_ids ?? [],
      created_refs: result.created_refs ?? {},
      session_id: result.session_id,
    };
  },
};

// venue handler: thin wrapper over the SECURITY DEFINER RPC bulk_import_commit_venues.
// Same shape as project + vendor; the RPC owns the session + activity_log writes and
// returns session_id, so the edge function skips its own session write below.
const venueHandler: EntityHandler = {
  entity_type: "venue",
  validate: (rows, queued_refs) => validateVenueImport(rows, queued_refs),
  commit: async (rows, queued_refs, sb, actor_id, column_set) => {
    const { data, error } = await sb.rpc("bulk_import_commit_venues", {
      payload: { actor_id, column_set, rows, queued_refs },
    });
    if (error) {
      throw new Error(`bulk_import_commit_venues failed: ${error.message}`);
    }
    const result = data as {
      ok?: boolean;
      session_id?: string;
      created_ids?: string[];
      created_refs?: Record<string, number>;
      error?: string;
    } | null;
    if (!result?.ok) {
      throw new Error(result?.error ?? "RPC returned ok=false without an error");
    }
    return {
      created_ids: result.created_ids ?? [],
      created_refs: result.created_refs ?? {},
      session_id: result.session_id,
    };
  },
};

const handlers: Record<string, EntityHandler> = {
  project: projectHandler,
  vendor: vendorHandler,
  venue: venueHandler,
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ ok: false, error: "Method not allowed" }, 405);
  }

  let body: BulkImportRequest;
  try {
    body = (await req.json()) as BulkImportRequest;
  } catch {
    return jsonResponse({ ok: false, error: "Invalid JSON body" }, 400);
  }

  const entity_type = (body.entity_type ?? "").trim();
  const mode = (body.mode ?? "").trim() as Mode;
  const rows = Array.isArray(body.rows) ? body.rows : [];
  const queued_refs = body.queued_refs && typeof body.queued_refs === "object"
    ? body.queued_refs as Record<string, Array<Record<string, unknown>>>
    : {};
  const column_set = Array.isArray(body.column_set) ? body.column_set as string[] : [];

  if (mode !== "preview" && mode !== "commit" && mode !== "undo") {
    return jsonResponse({ ok: false, error: "mode must be 'preview', 'commit', or 'undo'" }, 400);
  }
  // entity_type drives the handler for preview/commit. Undo reads it from the
  // session row, so it isn't required there.
  if (mode !== "undo" && !entity_type) {
    return jsonResponse({ ok: false, error: "entity_type is required" }, 400);
  }

  // Server-side admin re-check (spec § 9). Defense in depth on top of the
  // AdminRoute gate; a hand-crafted JWT-only POST gets denied here.
  const authHeader = req.headers.get("Authorization") ?? "";
  const userClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) {
    return jsonResponse({ ok: false, error: "Unauthorized" }, 401);
  }
  const userId = userData.user.id;
  const { data: roleRow, error: roleErr } = await userClient
    .from("users")
    .select("permission_role")
    .eq("id", userId)
    .single();
  if (roleErr || !roleRow) {
    return jsonResponse({ ok: false, error: "User row not found" }, 403);
  }
  if (roleRow.permission_role !== "admin") {
    return jsonResponse({ ok: false, error: "Forbidden: admin only" }, 403);
  }

  // Undo mode (Phase 5.9.6): revert a committed import. The SECURITY DEFINER
  // bulk_import_undo RPC owns the destructive multi-table delete in one
  // transaction (dry_run returns the cascade counts without writing). No
  // failed_rollback row on undo failure (that is commit-only); we just surface
  // the RPC error. Service-role client is the only thing that can delete the
  // immutable session row.
  if (mode === "undo") {
    const session_id = (body.session_id ?? "").trim();
    if (!session_id) {
      return jsonResponse({ ok: false, error: "session_id is required for undo" }, 400);
    }
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data, error } = await adminClient.rpc("bulk_import_undo", {
      p_session_id: session_id,
      p_actor_id: userId,
      p_dry_run: body.dry_run ?? false,
    });
    if (error) {
      return jsonResponse({ ok: false, error: error.message }, 400);
    }
    const result = (data ?? {}) as Record<string, unknown>;
    return jsonResponse({ ...result, mode }, 200);
  }

  const handler = handlers[entity_type];
  if (!handler) {
    return jsonResponse(
      { ok: false, error: `Entity handler not registered for '${entity_type}'` },
      400,
    );
  }

  const { errors, unresolved } = handler.validate(rows, queued_refs);
  if (errors.length > 0 || unresolved.length > 0) {
    return jsonResponse({
      ok: false,
      error: "Validation failed",
      validation_errors: errors,
      unresolved_refs: unresolved,
    }, 400);
  }

  if (mode === "preview") {
    return jsonResponse({
      ok: true,
      mode,
      parsed_count: rows.length,
      summary: { rows: rows.length, queued_ref_kinds: Object.keys(queued_refs) },
    });
  }

  // Service-role client for the commit transaction + audit-row write.
  const adminClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const result = await handler.commit(
      rows,
      queued_refs,
      adminClient,
      userId,
      column_set,
    );
    const { created_ids, created_refs } = result;

    // Handlers backed by a SECURITY DEFINER RPC (project / vendor / venue)
    // write the session + activity_log rows INSIDE the RPC transaction and
    // signal that by returning session_id. When present, skip the edge
    // function's own inserts to avoid a duplicate session row. The fallback
    // block below is the documented contract for any future non-RPC handler;
    // all three current handlers return session_id, so it stays dormant.
    let session_id: string | undefined = result.session_id;
    if (!session_id) {
      const { data: sessionRow, error: sessErr } = await adminClient
        .from("bulk_import_sessions")
        .insert({
          entity_type,
          actor: userId,
          row_count: created_ids.length,
          created_refs,
          column_set,
          status: "committed",
        })
        .select("id")
        .single();
      if (sessErr || !sessionRow) {
        throw new Error(`Failed to write bulk_import_sessions row: ${sessErr?.message ?? "unknown"}`);
      }
      session_id = sessionRow.id as string;

      const { error: actErr } = await adminClient
        .from("activity_log")
        .insert({
          entity_type: "bulk_import_session",
          entity_id: session_id,
          actor_id: userId,
          action: "bulk_import",
          payload: {
            entity_type,
            row_count: created_ids.length,
            created_refs,
          },
        });
      if (actErr) {
        console.error(`[bulk-import] activity_log insert failed: ${actErr.message}`);
      }
    }

    return jsonResponse({
      ok: true,
      mode,
      session_id,
      parsed_count: rows.length,
      created_ids,
      created_refs,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Failed-rollback audit insert (separate from the rolled-back work) so
    // incident traceability survives.
    const { error: failErr } = await adminClient
      .from("bulk_import_sessions")
      .insert({
        entity_type,
        actor: userId,
        row_count: 0,
        created_refs: {},
        column_set,
        status: "failed_rollback",
      });
    if (failErr) {
      console.error(`[bulk-import] failed-rollback audit insert failed: ${failErr.message}`);
    }
    return jsonResponse({ ok: false, error: message }, 500);
  }
});
