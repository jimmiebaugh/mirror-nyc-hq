import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type WikiPageType = "prose" | "team_directory" | "vendors_glance" | "account_logins";
export type WikiVisibility = "all" | "admin_only";

export type WikiPage = Database["public"]["Tables"]["wiki_pages"]["Row"] & {
  page_type: WikiPageType;
  visibility: WikiVisibility;
};

export type WikiPageWithUpdater = WikiPage & {
  updated_by_full_name: string | null;
};

const SPECIAL_PAGE_TYPES: WikiPageType[] = [
  "team_directory",
  "vendors_glance",
  "account_logins",
];

export function isSpecialPageType(t: WikiPageType): boolean {
  return SPECIAL_PAGE_TYPES.includes(t);
}

export async function loadWikiPages(): Promise<WikiPage[]> {
  const { data, error } = await supabase
    .from("wiki_pages")
    .select("*")
    .order("sort_order", { ascending: true });
  if (error) {
    console.warn("loadWikiPages error", error);
    return [];
  }
  return (data ?? []) as WikiPage[];
}

export async function loadWikiPageBySlug(
  slug: string,
): Promise<WikiPageWithUpdater | null> {
  const { data, error } = await supabase
    .from("wiki_pages")
    .select("*, updater:users!wiki_pages_updated_by_fkey(full_name)")
    .eq("slug", slug)
    .maybeSingle();
  if (error || !data) return null;
  type Row = WikiPage & { updater: { full_name: string | null } | null };
  const r = data as unknown as Row;
  return {
    ...r,
    updated_by_full_name: r.updater?.full_name ?? null,
  };
}

export function slugify(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}
