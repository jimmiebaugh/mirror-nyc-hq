import { supabase } from "@/integrations/supabase/client";

/**
 * Phase 5.7.2 mention helpers (spec § 6.C).
 *
 * Shared between InternalNotesEditor (typeahead source + offset validation
 * at save time) and the future render-time parser that walks `note_mentions`
 * to produce mention link spans.
 */

export type MentionableUser = {
  id: string;
  full_name: string | null;
  email: string;
};

export type PendingMention = {
  user_id: string;
  start_offset: number;
  length: number;
  name: string;
};

/** Load users eligible to be @-mentioned: active, non-pending tier. */
export async function loadMentionableUsers(): Promise<MentionableUser[]> {
  const { data, error } = await supabase
    .from("users")
    .select("id, full_name, email")
    .eq("active", true)
    .neq("permission_role", "pending")
    .order("full_name", { ascending: true });
  if (error) {
    console.warn("[mentions] loadMentionableUsers failed:", error);
    return [];
  }
  return (data ?? []) as MentionableUser[];
}

/** Display label used both inside the inserted @-token and in the typeahead. */
export function mentionLabel(u: MentionableUser): string {
  return u.full_name?.trim() || u.email;
}

/** Detect an active @-trigger at the cursor inside a textarea value.
 *
 *  Returns the start index of the `@` and the substring typed after it
 *  (the mention query) if and only if the cursor sits at the end of a
 *  contiguous, whitespace-bounded `@xxx` run. Returns null otherwise
 *  (typeahead should close). */
export function detectMentionTrigger(
  value: string,
  cursor: number,
): { atIndex: number; query: string } | null {
  if (cursor <= 0 || cursor > value.length) return null;
  // Walk back from cursor looking for an `@` preceded by start-of-string
  // or whitespace, with no whitespace between the `@` and the cursor.
  for (let i = cursor - 1; i >= 0; i--) {
    const ch = value[i];
    if (ch === "@") {
      const prev = i === 0 ? "" : value[i - 1];
      if (i === 0 || /\s/.test(prev)) {
        return { atIndex: i, query: value.slice(i + 1, cursor) };
      }
      return null;
    }
    if (/\s/.test(ch)) return null;
  }
  return null;
}

/** Confirm that a pending mention's `@Name` substring still sits at the
 *  recorded offset after subsequent edits. The save path drops mentions
 *  whose offsets no longer validate so we never persist stale FKs. */
export function validateMentionOffset(
  body: string,
  m: PendingMention,
): boolean {
  if (m.start_offset < 0 || m.start_offset + m.length > body.length) return false;
  const expected = `@${m.name}`;
  return body.slice(m.start_offset, m.start_offset + m.length) === expected;
}
