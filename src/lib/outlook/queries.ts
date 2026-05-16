import { supabase } from "@/integrations/supabase/client";

/**
 * Outlook page data loaders (Phase 5.3 spec § 3d).
 *
 * Outlook entries are admin-only data, but the loader doesn't gate by tier
 * here; the `/outlook` route gate (AdminRoute) + the RLS policy
 * (outlook_entries_select) together enforce the restriction. Standard
 * users would get only shared_with_team rows from the same select; the
 * Outlook page is unreachable for them so that scenario doesn't matter.
 */

export type OutlookConfidence = "On Radar" | "Likely" | "Confirmed" | "Complete";

export type OutlookEntry = {
  id: string;
  name: string;
  clientId: string | null;
  clientName: string | null;
  city: string | null;
  year: number;
  month: number;
  week: number;
  dateText: string | null;
  budget: number | null;
  confidence: OutlookConfidence;
  notes: string | null;
  linkedProjectId: string | null;
  linkedProjectName: string | null;
  sharedWithTeam: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

type EntryRow = {
  id: string;
  name: string;
  client_id: string | null;
  city: string | null;
  year: number;
  month: number;
  week: number;
  date_text: string | null;
  budget: number | null;
  confidence: OutlookConfidence;
  notes: string | null;
  linked_project_id: string | null;
  shared_with_team: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
  client: { id: string; name: string | null } | null;
  linked_project: { id: string; name: string } | null;
};

function mapEntry(r: EntryRow): OutlookEntry {
  return {
    id: r.id,
    name: r.name,
    clientId: r.client_id,
    clientName: r.client?.name ?? null,
    city: r.city,
    year: r.year,
    month: r.month,
    week: r.week,
    dateText: r.date_text,
    budget: r.budget,
    confidence: r.confidence,
    notes: r.notes,
    linkedProjectId: r.linked_project_id,
    linkedProjectName: r.linked_project?.name ?? null,
    sharedWithTeam: r.shared_with_team,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

const SELECT_COLUMNS =
  `id, name, client_id, city, year, month, week, date_text, budget,
   confidence, notes, linked_project_id, shared_with_team,
   created_by, created_at, updated_at,
   client:clients(id, name),
   linked_project:projects!outlook_entries_linked_project_id_fkey(id, name)`;

export async function loadOutlookEntriesForYear(year: number): Promise<OutlookEntry[]> {
  const { data, error } = await supabase
    .from("outlook_entries" as never)
    .select(SELECT_COLUMNS)
    .eq("year", year)
    .order("month")
    .order("week");
  if (error) {
    console.warn("loadOutlookEntriesForYear error", error);
    return [];
  }
  return ((data ?? []) as unknown as EntryRow[]).map(mapEntry);
}

export async function loadOutlookEntryById(id: string): Promise<OutlookEntry | null> {
  const { data, error } = await supabase
    .from("outlook_entries" as never)
    .select(SELECT_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.warn("loadOutlookEntryById error", error);
    return null;
  }
  if (!data) return null;
  return mapEntry(data as unknown as EntryRow);
}

export async function loadDistinctOutlookYears(): Promise<number[]> {
  const { data, error } = await supabase
    .from("outlook_entries" as never)
    .select("year");
  if (error) {
    console.warn("loadDistinctOutlookYears error", error);
    return [];
  }
  const set = new Set<number>();
  for (const r of (data ?? []) as { year: number }[]) {
    set.add(r.year);
  }
  return Array.from(set).sort((a, b) => b - a);
}

export type OutlookEntryInput = {
  name: string;
  clientId: string | null;
  city: string | null;
  year: number;
  month: number;
  week: number;
  dateText: string | null;
  budget: number | null;
  confidence: OutlookConfidence;
  notes: string | null;
  sharedWithTeam: boolean;
};

export async function createOutlookEntry(
  input: OutlookEntryInput,
): Promise<OutlookEntry> {
  const { data: userRes } = await supabase.auth.getUser();
  const created_by = userRes.user?.id;
  if (!created_by) throw new Error("Not signed in");
  const payload = {
    name: input.name,
    client_id: input.clientId,
    city: input.city,
    year: input.year,
    month: input.month,
    week: input.week,
    date_text: input.dateText,
    budget: input.budget,
    confidence: input.confidence,
    notes: input.notes,
    shared_with_team: input.sharedWithTeam,
    created_by,
  };
  const { data, error } = await supabase
    .from("outlook_entries" as never)
    .insert(payload as never)
    .select(SELECT_COLUMNS)
    .single();
  if (error) throw error;
  return mapEntry(data as unknown as EntryRow);
}

export async function updateOutlookEntry(
  id: string,
  patch: Partial<OutlookEntryInput>,
): Promise<OutlookEntry> {
  const payload: Record<string, unknown> = {};
  if (patch.name !== undefined) payload.name = patch.name;
  if (patch.clientId !== undefined) payload.client_id = patch.clientId;
  if (patch.city !== undefined) payload.city = patch.city;
  if (patch.year !== undefined) payload.year = patch.year;
  if (patch.month !== undefined) payload.month = patch.month;
  if (patch.week !== undefined) payload.week = patch.week;
  if (patch.dateText !== undefined) payload.date_text = patch.dateText;
  if (patch.budget !== undefined) payload.budget = patch.budget;
  if (patch.confidence !== undefined) payload.confidence = patch.confidence;
  if (patch.notes !== undefined) payload.notes = patch.notes;
  if (patch.sharedWithTeam !== undefined) payload.shared_with_team = patch.sharedWithTeam;
  const { data, error } = await supabase
    .from("outlook_entries" as never)
    .update(payload as never)
    .eq("id", id)
    .select(SELECT_COLUMNS)
    .single();
  if (error) throw error;
  return mapEntry(data as unknown as EntryRow);
}

export async function deleteOutlookEntry(id: string): Promise<void> {
  const { error } = await supabase
    .from("outlook_entries" as never)
    .delete()
    .eq("id", id);
  if (error) throw error;
}

export async function updateOutlookConfidence(
  id: string,
  confidence: OutlookConfidence,
): Promise<void> {
  const { error } = await supabase
    .from("outlook_entries" as never)
    .update({ confidence } as never)
    .eq("id", id);
  if (error) throw error;
}

export async function unlinkOutlookProject(id: string): Promise<OutlookEntry> {
  const { data, error } = await supabase
    .from("outlook_entries" as never)
    .update({ linked_project_id: null } as never)
    .eq("id", id)
    .select(SELECT_COLUMNS)
    .single();
  if (error) throw error;
  return mapEntry(data as unknown as EntryRow);
}

export async function promoteOutlookToProject(entryId: string): Promise<string> {
  const { data, error } = await supabase.rpc(
    "promote_outlook_to_project" as never,
    { target_entry_id: entryId } as never,
  );
  if (error) throw error;
  return data as unknown as string;
}
