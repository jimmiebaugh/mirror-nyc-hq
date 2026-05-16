import { supabase } from "@/integrations/supabase/client";

/**
 * Phase 5.5 multi-table search (spec § 6).
 *
 * Fires a parallel ilike against every searchable entity table, limits each
 * to 10 rows, returns them grouped by section. Client-side ranks
 * starts-with > contains so the most relevant result lands first inside
 * each section. Results are sorted on display, not at the query layer.
 *
 * RLS already scopes every read to the current user's allowed set
 * (authenticated full-read on HQ Core tables; admin-only on wiki when
 * applicable). The Promise.all swallows individual table errors so a
 * single failing query doesn't blank the whole search.
 */

export type SearchSection =
  | "projects"
  | "tasks"
  | "deliverables"
  | "venues"
  | "vendors"
  | "clients"
  | "people"
  | "wiki";

export type SearchResult = {
  section: SearchSection;
  id: string;
  title: string;
  subtitle?: string;
  href: string;
};

export type SearchResultGroup = {
  section: SearchSection;
  label: string;
  results: SearchResult[];
};

export const SECTION_LABELS: Record<SearchSection, string> = {
  projects: "Projects",
  tasks: "Tasks",
  deliverables: "Deliverables",
  venues: "Venues",
  vendors: "Vendors",
  clients: "Clients",
  people: "People",
  wiki: "Wiki",
};

const LIMIT_PER_SECTION = 10;

/**
 * Lightweight string ranker: starts-with > contains > other; within a tier
 * sort alphabetically.
 */
function rankAndSort(results: SearchResult[], query: string): SearchResult[] {
  const q = query.toLowerCase();
  return [...results].sort((a, b) => {
    const aTitle = a.title.toLowerCase();
    const bTitle = b.title.toLowerCase();
    const aStarts = aTitle.startsWith(q) ? 0 : 1;
    const bStarts = bTitle.startsWith(q) ? 0 : 1;
    if (aStarts !== bStarts) return aStarts - bStarts;
    return aTitle.localeCompare(bTitle);
  });
}

function ilikeNeedle(query: string): string {
  // ilike pattern: wildcards on both ends, escape underscores + percents.
  const escaped = query.replace(/[%_]/g, (m) => `\\${m}`);
  return `%${escaped}%`;
}

async function searchProjects(query: string): Promise<SearchResult[]> {
  const { data, error } = await supabase
    .from("projects")
    .select("id, name, status, clients(name)")
    .ilike("name", ilikeNeedle(query))
    .is("archived_at", null)
    .limit(LIMIT_PER_SECTION);
  if (error) return [];
  return (data ?? []).map((row) => ({
    section: "projects" as const,
    id: row.id,
    title: row.name,
    subtitle:
      [row.status, (row.clients as { name?: string | null } | null)?.name]
        .filter(Boolean)
        .join(" · ") || undefined,
    href: `/projects/${row.id}`,
  }));
}

async function searchTasks(query: string): Promise<SearchResult[]> {
  const { data, error } = await supabase
    .from("tasks")
    .select("id, title, status, projects(name)")
    .or(`title.ilike.${ilikeNeedle(query)},description.ilike.${ilikeNeedle(query)}`)
    .limit(LIMIT_PER_SECTION);
  if (error) return [];
  return (data ?? []).map((row) => ({
    section: "tasks" as const,
    id: row.id,
    title: row.title,
    subtitle:
      [row.status, (row.projects as { name?: string | null } | null)?.name]
        .filter(Boolean)
        .join(" · ") || undefined,
    href: `/tasks/${row.id}`,
  }));
}

async function searchDeliverables(query: string): Promise<SearchResult[]> {
  const { data, error } = await supabase
    .from("deliverables")
    .select("id, title, status, project_id, projects(name)")
    .ilike("title", ilikeNeedle(query))
    .limit(LIMIT_PER_SECTION);
  if (error) return [];
  return (data ?? []).map((row) => ({
    section: "deliverables" as const,
    id: row.id,
    title: row.title,
    subtitle:
      [row.status, (row.projects as { name?: string | null } | null)?.name]
        .filter(Boolean)
        .join(" · ") || undefined,
    href: `/projects/${row.project_id}`,
  }));
}

async function searchVenues(query: string): Promise<SearchResult[]> {
  const { data, error } = await supabase
    .from("venues")
    .select("id, name, neighborhood, address")
    .or(
      `name.ilike.${ilikeNeedle(query)},neighborhood.ilike.${ilikeNeedle(query)},address.ilike.${ilikeNeedle(query)}`,
    )
    .limit(LIMIT_PER_SECTION);
  if (error) return [];
  return (data ?? []).map((row) => ({
    section: "venues" as const,
    id: row.id,
    title: row.name,
    subtitle: [row.neighborhood, row.address].filter(Boolean).join(" · ") || undefined,
    href: `/venues/${row.id}`,
  }));
}

async function searchVendors(query: string): Promise<SearchResult[]> {
  const { data, error } = await supabase
    .from("vendors")
    .select("id, name, vendor_categories(name)")
    .ilike("name", ilikeNeedle(query))
    .limit(LIMIT_PER_SECTION);
  if (error) return [];
  return (data ?? []).map((row) => ({
    section: "vendors" as const,
    id: row.id,
    title: row.name,
    subtitle: (row.vendor_categories as { name?: string | null } | null)?.name ?? undefined,
    href: `/vendors/${row.id}`,
  }));
}

async function searchClients(query: string): Promise<SearchResult[]> {
  const { data, error } = await supabase
    .from("clients")
    .select("id, name, contact_name")
    .ilike("name", ilikeNeedle(query))
    .limit(LIMIT_PER_SECTION);
  if (error) return [];
  return (data ?? []).map((row) => ({
    section: "clients" as const,
    id: row.id,
    title: row.name,
    subtitle: row.contact_name ?? undefined,
    href: `/clients/${row.id}`,
  }));
}

async function searchPeople(query: string): Promise<SearchResult[]> {
  const { data, error } = await supabase
    .from("people")
    .select("id, full_name, email, role_title, organizations(name)")
    .or(`full_name.ilike.${ilikeNeedle(query)},email.ilike.${ilikeNeedle(query)}`)
    .limit(LIMIT_PER_SECTION);
  if (error) return [];
  return (data ?? []).map((row) => ({
    section: "people" as const,
    id: row.id,
    title: row.full_name,
    subtitle:
      [row.role_title, (row.organizations as { name?: string | null } | null)?.name]
        .filter(Boolean)
        .join(" · ") || row.email || undefined,
    href: `/people/${row.id}`,
  }));
}

async function searchWiki(query: string): Promise<SearchResult[]> {
  const { data, error } = await supabase
    .from("wiki_pages")
    .select("id, slug, title, body")
    .or(`title.ilike.${ilikeNeedle(query)},body.ilike.${ilikeNeedle(query)}`)
    .limit(LIMIT_PER_SECTION);
  if (error) return [];
  return (data ?? []).map((row) => {
    // Snippet: first chunk of body containing the query, capped at 80 chars.
    let snippet: string | undefined = undefined;
    if (row.body) {
      const idx = row.body.toLowerCase().indexOf(query.toLowerCase());
      if (idx >= 0) {
        const start = Math.max(0, idx - 20);
        snippet = row.body.slice(start, start + 80).replace(/\s+/g, " ").trim();
        if (start > 0) snippet = `...${snippet}`;
      } else {
        snippet = row.body.slice(0, 80).replace(/\s+/g, " ").trim();
      }
    }
    return {
      section: "wiki" as const,
      id: row.id,
      title: row.title,
      subtitle: snippet,
      href: `/wiki/${row.slug}`,
    };
  });
}

/**
 * Run every section query in parallel, rank within each, return groups
 * in the canonical display order. Empty groups are dropped from the
 * returned array so the caller can render a single "no results" state
 * when length === 0.
 */
export async function runSearch(query: string): Promise<SearchResultGroup[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const [
    projects,
    tasks,
    deliverables,
    venues,
    vendors,
    clients,
    people,
    wiki,
  ] = await Promise.all([
    searchProjects(trimmed),
    searchTasks(trimmed),
    searchDeliverables(trimmed),
    searchVenues(trimmed),
    searchVendors(trimmed),
    searchClients(trimmed),
    searchPeople(trimmed),
    searchWiki(trimmed),
  ]);

  const groups: SearchResultGroup[] = [
    { section: "projects", label: SECTION_LABELS.projects, results: rankAndSort(projects, trimmed) },
    { section: "tasks", label: SECTION_LABELS.tasks, results: rankAndSort(tasks, trimmed) },
    { section: "deliverables", label: SECTION_LABELS.deliverables, results: rankAndSort(deliverables, trimmed) },
    { section: "venues", label: SECTION_LABELS.venues, results: rankAndSort(venues, trimmed) },
    { section: "vendors", label: SECTION_LABELS.vendors, results: rankAndSort(vendors, trimmed) },
    { section: "clients", label: SECTION_LABELS.clients, results: rankAndSort(clients, trimmed) },
    { section: "people", label: SECTION_LABELS.people, results: rankAndSort(people, trimmed) },
    { section: "wiki", label: SECTION_LABELS.wiki, results: rankAndSort(wiki, trimmed) },
  ];

  return groups.filter((g) => g.results.length > 0);
}
