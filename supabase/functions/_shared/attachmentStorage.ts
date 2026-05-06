// Persist large attachments to Supabase Storage so they don't have to stream
// live from Gmail (avoids WORKER_RESOURCE_LIMIT on big files).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

export const LARGE_ATTACHMENT_THRESHOLD_BYTES = 5 * 1024 * 1024; // 5MB
// HQ uses underscores in bucket names per its 20260506061457_initial_schema.sql.
export const STORAGE_BUCKET = "candidate_attachments";

export type AttachmentMeta = {
  id: string;
  filename: string;
  mimeType: string;
  size: number | null;
  /** Set when the binary was persisted to Storage. */
  storage_url?: string | null;
  storage_path?: string | null;
};

function sanitizeFilename(name: string): string {
  return (name || "file").replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 180);
}

/**
 * Upload bytes to the (private) candidate-attachments bucket. Returns the storage path.
 * Frontend mints signed URLs via the get-attachment-url edge function.
 * Path: {roleId}/{candidateId}/{filename}
 */
export async function uploadAttachmentToStorage(opts: {
  bytes: Uint8Array;
  roleId: string;
  candidateId: string;
  filename: string;
  mimeType: string;
}): Promise<{ publicUrl: string | null; path: string } | null> {
  try {
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const safeName = sanitizeFilename(opts.filename);
    const path = `${opts.roleId}/${opts.candidateId}/${safeName}`;
    const { error } = await sb.storage
      .from(STORAGE_BUCKET)
      .upload(path, opts.bytes, {
        contentType: opts.mimeType || "application/octet-stream",
        upsert: true,
      });
    if (error) {
      console.error(`[storage-upload] Failed ${path}: ${error.message}`);
      return null;
    }
    return { publicUrl: null, path };
  } catch (e) {
    console.error("[storage-upload] Exception:", e);
    return null;
  }
}
