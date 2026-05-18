import { supabase } from "@/integrations/supabase/client";

/**
 * Extract storage paths from `<img src>` URLs in wiki HTML body.
 *
 * Signed URLs: https://<project>.supabase.co/storage/v1/object/sign/wiki_images/<path>?token=...
 * Public URLs (legacy / future fallback): https://<project>.supabase.co/storage/v1/object/public/wiki_images/<path>
 *
 * Returns the bare `<path>` portion suitable for `storage.from('wiki_images').remove([...])`.
 */
export function extractWikiImagePaths(html: string): string[] {
  if (!html) return [];
  const pattern = /\/storage\/v1\/object\/(?:sign|public)\/wiki_images\/([^?"\s>]+)/g;
  const paths = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    paths.add(decodeURIComponent(match[1]));
  }
  return Array.from(paths);
}

/**
 * Delete the storage paths present in `oldHtml` but absent in `newHtml`.
 * Best-effort: errors logged but don't block the surrounding save.
 */
export async function cleanupRemovedWikiImages(
  oldHtml: string,
  newHtml: string,
): Promise<void> {
  const oldPaths = new Set(extractWikiImagePaths(oldHtml));
  const newPaths = new Set(extractWikiImagePaths(newHtml));
  const removed = Array.from(oldPaths).filter((p) => !newPaths.has(p));
  if (removed.length === 0) return;
  const { error } = await supabase.storage.from("wiki_images").remove(removed);
  if (error) {
    console.warn("[wiki_images] cleanup failed", { paths: removed, error });
  }
}

/**
 * Track files uploaded during the current edit session. On cancel /
 * navigate-away without save, delete every file in this list (they never
 * reached the persisted body). On successful save, clear the list (the
 * diff-on-save handler covers any subsequent removes).
 */
export function makeSessionUploadTracker() {
  const paths = new Set<string>();
  return {
    add: (path: string) => {
      paths.add(path);
    },
    clear: () => {
      paths.clear();
    },
    list: () => Array.from(paths),
    cleanupAll: async () => {
      if (paths.size === 0) return;
      const toRemove = Array.from(paths);
      const { error } = await supabase.storage
        .from("wiki_images")
        .remove(toRemove);
      if (error) {
        console.warn("[wiki_images] session cleanup failed", {
          paths: toRemove,
          error,
        });
      }
      paths.clear();
    },
  };
}
