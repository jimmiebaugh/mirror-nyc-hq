import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { formatMediumDate } from "@/lib/hq/dates";
import { toast } from "@/hooks/use-toast";
import { IconX } from "@/components/icons/HQIcons";
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

/**
 * Append-only Internal Notes editor shared by Client / Vendor / Person /
 * Venue detail surfaces (Phase 5.2.2 § 6.A; parentType union widened in
 * Phase 5.2.3 to absorb the organizations -> clients + vendors split).
 *
 * Wireframe reference: OUTPUTS/phase-5-hq-wireframe-v1-LOCKED.html lines
 * 1917-1934 (Org detail Internal Notes card; same DOM applies to both
 * Client + Vendor Detail surfaces in 5.2.3). DOM is the canonical
 * `.card > .card-headbar (h-card + cap) > .card-pad (column gap:14px) >
 * note rows + Add a note block`.
 *
 * Notes are immutable except for delete; the author OR an admin can
 * delete (RLS enforces this server-side). The disambiguated FK alias
 * `users!notes_log_author_id_fkey` follows the Phase 5.2.1 Revision
 * PGRST201 lesson, even though notes_log only has one user FK; future
 * additions to the table won't silently break the embed.
 */

type Author = { full_name: string | null; email: string | null };
type Note = {
  id: string;
  body: string;
  author_id: string;
  created_at: string;
  author: Author | null;
};

const PARENT_TYPES = ["client", "vendor", "person", "venue"] as const;
type ParentType = (typeof PARENT_TYPES)[number];

export function InternalNotesEditor({
  parentType,
  parentId,
}: {
  parentType: ParentType;
  parentId: string;
}) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Note | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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
        return;
      }
      setNotes((data ?? []) as unknown as Note[]);
    })();
    return () => {
      active = false;
    };
  }, [parentType, parentId]);

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
    setSaving(false);
    if (error || !data) {
      toast({
        title: "Could not save note",
        description: error?.message,
        variant: "destructive",
      });
      return;
    }
    setNotes((prev) => [data as unknown as Note, ...prev]);
    setDraft("");
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
    setConfirmDelete(null);
  };

  return (
    <section className="card">
      <div className="card-headbar">
        <span className="h-card">Internal Notes</span>
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
          notes.map((n, i) => {
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
                  {n.body}
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
          <textarea
            ref={textareaRef}
            className="input textarea"
            style={{ minHeight: 60, width: "100%" }}
            placeholder="Type a new note. Existing notes stay locked."
            onChange={(e) => setDraft(e.target.value)}
            disabled={saving}
          />
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
              notes can't be edited, but the author or an admin can delete.
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
