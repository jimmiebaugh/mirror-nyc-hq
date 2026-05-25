export type Searchable = {
  name?: string | null;
  email?: string | null;
  location?: string | null;
  recruiter_overview?: string | null;
  top_strengths?: unknown[] | null;
  key_gaps?: unknown[] | null;
  quick_overview?: unknown[] | null;
};

function buildSearchableText(c: Searchable): string {
  const arrToStrings = (a: unknown[] | null | undefined) =>
    (a ?? []).map((v) => (typeof v === "string" ? v : ""));
  return [
    c.name,
    c.email,
    c.location,
    c.recruiter_overview,
    ...arrToStrings(c.top_strengths),
    ...arrToStrings(c.key_gaps),
    ...arrToStrings(c.quick_overview),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function matchesSearch(c: Searchable, term: string): boolean {
  if (!term) return true;
  return buildSearchableText(c).includes(term.toLowerCase());
}
