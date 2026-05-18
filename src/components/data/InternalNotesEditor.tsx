import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { formatMediumDate } from "@/lib/hq/dates";
import { toast } from "@/hooks/use-toast";
import { IconX } from "@/components/icons/HQIcons";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  detectMentionTrigger,
  loadMentionableUsers,
  mentionLabel,
  validateMentionOffset,
  type MentionableUser,
  type PendingMention,
} from "@/lib/notes/mentions";

/**
 * Append-only Internal Notes editor shared by Client / Vendor / Person /
 * Venue / Outlook detail surfaces (Phase 5.2.2 § 6.A; parentType union
 * widened in Phase 5.2.3 to absorb the organizations -> clients + vendors
 * split; Phase 5.6.4.1 added outlook_entry).
 *
 * Phase 5.7.2: extended for Task + Deliverable parents and for @-mentions.
 * The textarea grows an @-typeahead popover (cmdk Command, anchored below
 * the textarea for layout simplicity per spec § 6.C "anchor-below-textarea
 * fallback acceptable"). Picking a user inserts `@Full Name` at the cursor
 * AND queues a pending mention `{user_id, start_offset, length, name}`.
 * At save time, mentions whose offsets still validate against the final
 * body are INSERTed into `note_mentions`; the Postgres triggers fan out a
 * `notifications` row and an `activity_log` row per mention. Render path
 * walks `note_mentions` per note and produces coral `<Link>` spans to
 * `/users/${mentioned_user_id}` (the read-only Profile route landed in
 * Phase 5.7.12; replaces the prior /users cap that demoted to spans for
 * non-admin viewers).
 *
 * Notes themselves stay immutable except for delete; the author OR an
 * admin can delete (RLS enforces this server-side). The disambiguated
 * FK alias `users!notes_log_author_id_fkey` follows the Phase 5.2.1
 * Revision PGRST201 lesson, even though notes_log only has one user FK;
 * future additions to the table won't silently break the embed.
 */

type Author = { full_name: string | null; email: string | null };
type Note = {
  id: string;
  body: string;
  author_id: string;
  created_at: string;
  author: Author | null;
};
type MentionRow = {
  note_id: string;
  mentioned_user_id: string;
  start_offset: number;
  length: number;
};

const PARENT_TYPES = [
  "client",
  "vendor",
  "person",
  "venue",
  "outlook_entry",
  "task",
  "deliverable",
  "project",
] as const;
type ParentType = (typeof PARENT_TYPES)[number];

export function InternalNotesEditor({
  parentType,
  parentId,
  title = "Internal Notes",
  maxVisibleNotes,
}: {
  parentType: ParentType;
  parentId: string;
  title?: string;
  /**
   * Phase 5.7.3 followup-14: cap the number of historical notes shown in
   * the card. Notes beyond this count are hidden from the list but still
   * loaded (so add/delete behavior stays correct). When omitted, all
   * notes render. ProjectDetail's Status Notes uses `2`; every other
   * surface keeps the default unlimited list.
   */
  maxVisibleNotes?: number;
}) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [mentionsByNote, setMentionsByNote] = useState<
    Record<string, MentionRow[]>
  >({});
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Note | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Mention state.
  const [mentionUsers, setMentionUsers] = useState<MentionableUser[]>([]);
  const [pendingMentions, setPendingMentions] = useState<PendingMention[]>([]);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionAtIndex, setMentionAtIndex] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data: userRes } = await supabase.auth.getUser();
      if (!active) return;
      const uid = userRes.user?.id ?? null;
      setCurrentUserId(uid);
      if (uid) {
        const { data: profile } = await supabase
          .from("users")
          .select("permission_role")
          .eq("id", uid)
          .maybeSingle();
        if (active) {
          setIsAdmin(profile?.permission_role === "admin");
        }
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // Mentionable-users load (active + non-pending). Best-effort: if it fails
  // the typeahead just produces no results.
  useEffect(() => {
    let active = true;
    loadMentionableUsers().then((list) => {
      if (active) setMentionUsers(list);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!parentId) return;
    let active = true;
    setLoading(true);
    (async () => {
      const { data, error } = await supabase
        .from("notes_log")
        .select(
          "id, body, author_id, created_at, author:users!notes_log_author_id_fkey(full_name, email)",
        )
        .eq("parent_type", parentType)
        .eq("parent_id", parentId)
        .order("created_at", { ascending: false });
      if (!active) return;
      setLoading(false);
      if (error) {
        console.warn("notes_log load failed", error);
        setNotes([]);
        setMentionsByNote({});
        return;
      }
      const rows = (data ?? []) as unknown as Note[];
      setNotes(rows);
      // Load mentions for every loaded note in one round-trip.
      const ids = rows.map((r) => r.id);
      if (ids.length === 0) {
        setMentionsByNote({});
        return;
      }
      const { data: mData, error: mErr } = await supabase
        .from("note_mentions")
        .select("note_id, mentioned_user_id, start_offset, length")
        .in("note_id", ids);
      if (!active) return;
      if (mErr) {
        console.warn("note_mentions load failed", mErr);
        setMentionsByNote({});
        return;
      }
      const map: Record<string, MentionRow[]> = {};
      for (const m of (mData ?? []) as MentionRow[]) {
        (map[m.note_id] ??= []).push(m);
      }
      // Sort each note's mentions by offset so the render walk is linear.
      for (const k of Object.keys(map)) {
        map[k].sort((a, b) => a.start_offset - b.start_offset);
      }
      setMentionsByNote(map);
    })();
    return () => {
      active = false;
    };
  }, [parentType, parentId]);

  const onChangeDraft = (next: string, cursor: number) => {
    setDraft(next);
    // Drop pending mentions whose recorded substring no longer matches.
    setPendingMentions((prev) =>
      prev.filter((m) => validateMentionOffset(next, m)),
    );
    const trig = detectMentionTrigger(next, cursor);
    if (trig) {
      setMentionAtIndex(trig.atIndex);
      setMentionQuery(trig.query);
      setMentionOpen(true);
    } else {
      setMentionOpen(false);
      setMentionAtIndex(null);
      setMentionQuery("");
    }
  };

  const insertMention = (user: MentionableUser) => {
    const ta = textareaRef.current;
    if (!ta || mentionAtIndex == null) return;
    const cursor = ta.selectionStart ?? draft.length;
    const name = mentionLabel(user);
    const token = `@${name}`;
    const next = draft.slice(0, mentionAtIndex) + token + " " + draft.slice(cursor);
    const newPending: PendingMention = {
      user_id: user.id,
      start_offset: mentionAtIndex,
      length: token.length,
      name,
    };
    // Drop any prior pending entry that shared this offset (re-pick case).
    setPendingMentions((prev) => [
      ...prev.filter((m) => m.start_offset !== mentionAtIndex),
      newPending,
    ]);
    setDraft(next);
    setMentionOpen(false);
    setMentionAtIndex(null);
    setMentionQuery("");
    // Re-anchor the textarea + cursor after React commits the new value.
    requestAnimationFrame(() => {
      const cur = textareaRef.current;
      if (!cur) return;
      cur.value = next;
      const newCursor = mentionAtIndex + token.length + 1;
      cur.focus();
      cur.setSelectionRange(newCursor, newCursor);
    });
  };

  const filteredMentionUsers = useMemo(() => {
    const q = mentionQuery.toLowerCase();
    if (!q) return mentionUsers.slice(0, 8);
    return mentionUsers
      .filter((u) => {
        const name = (u.full_name ?? "").toLowerCase();
        const email = (u.email ?? "").toLowerCase();
        return name.includes(q) || email.includes(q);
      })
      .slice(0, 8);
  }, [mentionUsers, mentionQuery]);

  const onAdd = async () => {
    const body = draft.trim();
    if (!body || !currentUserId) return;
    setSaving(true);
    const { data, error } = await supabase
      .from("notes_log")
      .insert({
        parent_type: parentType,
        parent_id: parentId,
        body,
        author_id: currentUserId,
      })
      .select(
        "id, body, author_id, created_at, author:users!notes_log_author_id_fkey(full_name, email)",
      )
      .single();
    if (error || !data) {
      setSaving(false);
      toast({
        title: "Could not save note",
        description: error?.message,
        variant: "destructive",
      });
      return;
    }
    const newNote = data as unknown as Note;

    // Persist mentions that still validate against the final body. The body
    // we save trims leading/trailing whitespace; recompute offsets relative
    // to the trimmed string so the saved offsets address into the persisted
    // body, not the draft.
    const leadingTrim = draft.length - draft.trimStart().length;
    const validMentions = pendingMentions
      .filter((m) => validateMentionOffset(draft, m))
      .map((m) => ({
        note_id: newNote.id,
        mentioned_user_id: m.user_id,
        start_offset: m.start_offset - leadingTrim,
        length: m.length,
      }))
      .filter(
        (m) => m.start_offset >= 0 && m.start_offset + m.length <= body.length,
      );

    if (validMentions.length > 0) {
      const { error: mErr } = await supabase
        .from("note_mentions")
        .insert(validMentions);
      if (mErr) {
        console.warn("[InternalNotesEditor] mention insert failed:", mErr);
        toast({
          title: "Note saved",
          description: "Some mentions did not record.",
        });
      } else {
        // Reflect persisted mentions locally so the new note renders linked
        // tokens immediately without waiting for a refetch.
        setMentionsByNote((prev) => ({
          ...prev,
          [newNote.id]: validMentions.map((v) => ({
            note_id: v.note_id,
            mentioned_user_id: v.mentioned_user_id,
            start_offset: v.start_offset,
            length: v.length,
          })),
        }));
      }
    }

    setSaving(false);
    setNotes((prev) => [newNote, ...prev]);
    setDraft("");
    setPendingMentions([]);
    if (textareaRef.current) textareaRef.current.value = "";
  };

  const onDelete = async (note: Note) => {
    const { error } = await supabase
      .from("notes_log")
      .delete()
      .eq("id", note.id);
    if (error) {
      toast({
        title: "Could not delete note",
        description: error.message,
        variant: "destructive",
      });
      return;
    }
    setNotes((prev) => prev.filter((n) => n.id !== note.id));
    setMentionsByNote((prev) => {
      const next = { ...prev };
      delete next[note.id];
      return next;
    });
    setConfirmDelete(null);
  };

  const renderNoteBody = (note: Note) => {
    const mentions = mentionsByNote[note.id] ?? [];
    if (mentions.length === 0) return note.body;
    // Walk mentions in order, splicing text + Link segments.
    const out: React.ReactNode[] = [];
    let cursor = 0;
    mentions.forEach((m, idx) => {
      if (m.start_offset < cursor) return; // overlapping/invalid; skip
      if (m.start_offset + m.length > note.body.length) return;
      if (m.start_offset > cursor) {
        out.push(note.body.slice(cursor, m.start_offset));
      }
      const token = note.body.slice(m.start_offset, m.start_offset + m.length);
      // Phase 5.7.12: every tier can view /users/:id (read-only Profile),
      // so render mentions as coral links for everyone. Replaces the
      // 5.7.2 admin-only / span-fallback split.
      out.push(
        <Link
          key={`m-${note.id}-${idx}`}
          to={`/users/${m.mentioned_user_id}`}
          style={{ color: "hsl(var(--primary))", fontWeight: 500 }}
        >
          {token}
        </Link>,
      );
      cursor = m.start_offset + m.length;
    });
    if (cursor < note.body.length) {
      out.push(note.body.slice(cursor));
    }
    return out.map((c, i) => <Fragment key={`s-${note.id}-${i}`}>{c}</Fragment>);
  };

  return (
    <section className="card">
      <div className="card-headbar">
        <span className="h-card">{title}</span>
      </div>
      <div
        className="card-pad"
        style={{ display: "flex", flexDirection: "column", gap: 14 }}
      >
        {loading ? (
          <p className="subtle" style={{ fontSize: 13 }}>
            Loading...
          </p>
        ) : notes.length === 0 ? (
          <p className="subtle" style={{ fontSize: 13 }}>
            No notes yet. Add the first one below.
          </p>
        ) : (
          (maxVisibleNotes != null ? notes.slice(0, maxVisibleNotes) : notes).map((n, i) => {
            const canDelete = currentUserId === n.author_id || isAdmin;
            const authorName =
              n.author?.full_name ?? n.author?.email ?? "Unknown";
            return (
              <div
                key={n.id}
                style={
                  i === 0
                    ? undefined
                    : {
                        borderTop: "1px solid hsl(var(--border))",
                        paddingTop: 13,
                      }
                }
              >
                <div
                  className="row between"
                  style={{ alignItems: "flex-start", gap: 8 }}
                >
                  <div
                    className="cap"
                    style={{ color: "hsl(var(--subtle-foreground))" }}
                  >
                    {authorName} &middot; {formatMediumDate(n.created_at)}
                  </div>
                  {canDelete ? (
                    <button
                      type="button"
                      aria-label="Delete note"
                      onClick={() => setConfirmDelete(n)}
                      className="note-x"
                      style={{
                        background: "transparent",
                        border: 0,
                        cursor: "pointer",
                        color: "hsl(var(--subtle-foreground))",
                        opacity: 0.5,
                        padding: 0,
                        display: "inline-flex",
                      }}
                    >
                      <IconX className="ic" style={{ width: 12, height: 12 }} />
                    </button>
                  ) : null}
                </div>
                <p
                  style={{
                    fontSize: 13,
                    lineHeight: 1.6,
                    color: "hsl(var(--muted-foreground))",
                    marginTop: 5,
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {renderNoteBody(n)}
                </p>
              </div>
            );
          })
        )}

        <div
          style={{
            borderTop:
              notes.length === 0 ? undefined : "1px solid hsl(var(--border))",
            paddingTop: notes.length === 0 ? undefined : 13,
          }}
        >
          <div
            className="label-form"
            style={{
              color: "hsl(var(--subtle-foreground))",
              marginBottom: 7,
            }}
          >
            Add a note
          </div>
          <div style={{ position: "relative" }}>
            <textarea
              ref={textareaRef}
              className="input textarea"
              style={{ minHeight: 60, width: "100%" }}
              value={draft}
              placeholder="Add a new note - existing notes remain. @ to mention a teammate."
              onChange={(e) =>
                onChangeDraft(e.target.value, e.target.selectionStart ?? 0)
              }
              onKeyDown={(e) => {
                if (e.key === "Escape" && mentionOpen) {
                  e.stopPropagation();
                  setMentionOpen(false);
                }
              }}
              onBlur={() => {
                // Close popover when focus leaves the textarea, but defer so
                // a click inside the popover can still register.
                setTimeout(() => setMentionOpen(false), 120);
              }}
              disabled={saving}
            />
            {mentionOpen && filteredMentionUsers.length > 0 ? (
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  top: "100%",
                  marginTop: 4,
                  zIndex: 50,
                  width: 260,
                  borderRadius: 6,
                  border: "1px solid hsl(var(--border))",
                  background: "hsl(var(--popover))",
                  color: "hsl(var(--popover-foreground))",
                  boxShadow:
                    "0 4px 10px -2px rgba(0,0,0,.08), 0 2px 4px -1px rgba(0,0,0,.06)",
                }}
                // Prevent the textarea blur from firing before the click.
                onMouseDown={(e) => e.preventDefault()}
              >
                <Command shouldFilter={false}>
                  <CommandList>
                    <CommandEmpty>No matches</CommandEmpty>
                    <CommandGroup>
                      {filteredMentionUsers.map((u) => (
                        <CommandItem
                          key={u.id}
                          value={mentionLabel(u)}
                          onSelect={() => insertMention(u)}
                        >
                          <span style={{ fontWeight: 500 }}>
                            {u.full_name ?? u.email}
                          </span>
                          {u.full_name ? (
                            <span
                              style={{
                                marginLeft: 8,
                                fontSize: 11,
                                color: "hsl(var(--subtle-foreground))",
                              }}
                            >
                              {u.email}
                            </span>
                          ) : null}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </div>
            ) : null}
          </div>
          <div
            className="row"
            style={{ justifyContent: "flex-end", marginTop: 8 }}
          >
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={onAdd}
              disabled={!draft.trim() || saving || !currentUserId}
            >
              Add Note
            </button>
          </div>
        </div>
      </div>

      <AlertDialog
        open={Boolean(confirmDelete)}
        onOpenChange={(v) => !v && setConfirmDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this note?</AlertDialogTitle>
            <AlertDialogDescription>
              The note will be removed permanently. Append-only means existing
              notes can&apos;t be edited, but the author or an admin can delete.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmDelete && onDelete(confirmDelete)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
