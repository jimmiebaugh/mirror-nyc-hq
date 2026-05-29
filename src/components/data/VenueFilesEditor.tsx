import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { IconPlus, IconX } from "@/components/icons/HQIcons";
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
 * Phase 6.4 (V2): venue Files & Assets card. Clone of VendorFilesEditor
 * (vendor -> venue) backed by the venue_files table. URL + title list shared
 * by VenueDetail (read-write) and VenueEdit (read-write, !isCreate only).
 * Open-authenticated RLS (is_active_member): every active member can
 * SELECT/INSERT/DELETE; the confirm dialog is the only friction.
 *
 * Both INSERT and DELETE are server-confirmed. State managed locally; not tied
 * to VenueEdit's StickySaveBar dirty tracking (adds commit immediately).
 */

type VenueFile = {
  id: string;
  title: string;
  url: string;
  created_by: string | null;
  created_at: string;
};

export function VenueFilesEditor({ venueId }: { venueId: string }) {
  const [rows, setRows] = useState<VenueFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [urlDraft, setUrlDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<VenueFile | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data: userRes } = await supabase.auth.getUser();
      if (!active) return;
      setCurrentUserId(userRes.user?.id ?? null);
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!venueId) return;
    let active = true;
    setLoading(true);
    (async () => {
      const { data, error } = await supabase
        .from("venue_files")
        .select("id, title, url, created_by, created_at")
        .eq("venue_id", venueId)
        .order("created_at", { ascending: false });
      if (!active) return;
      setLoading(false);
      if (error) {
        console.warn("venue_files load failed", error);
        setRows([]);
        return;
      }
      setRows((data ?? []) as VenueFile[]);
    })();
    return () => {
      active = false;
    };
  }, [venueId]);

  const handleAdd = async () => {
    const title = titleDraft.trim();
    const url = urlDraft.trim();
    if (!title || !url || !currentUserId) return;
    setSaving(true);
    const { data, error } = await supabase
      .from("venue_files")
      .insert({
        venue_id: venueId,
        title,
        url,
        created_by: currentUserId,
      })
      .select("id, title, url, created_by, created_at")
      .single();
    setSaving(false);
    if (error || !data) {
      toast({
        title: "Could not save link",
        description: error?.message,
        variant: "destructive",
      });
      return;
    }
    setRows((prev) => [data as VenueFile, ...prev]);
    setExpanded(false);
    setTitleDraft("");
    setUrlDraft("");
  };

  const handleDelete = async (f: VenueFile) => {
    const { error } = await supabase
      .from("venue_files")
      .delete()
      .eq("id", f.id);
    if (error) {
      toast({
        title: "Could not delete link",
        description: error.message,
        variant: "destructive",
      });
      return;
    }
    setRows((prev) => prev.filter((r) => r.id !== f.id));
    setConfirmDelete(null);
  };

  return (
    <section className="card">
      <div className="card-headbar">
        <span className="h-card">Files &amp; Assets</span>
      </div>
      <div
        className="card-pad"
        style={{ display: "flex", flexDirection: "column", gap: 10 }}
      >
        {loading ? (
          <p className="subtle" style={{ fontSize: 13 }}>
            Loading...
          </p>
        ) : rows.length === 0 ? (
          <p className="subtle" style={{ fontSize: 13 }}>
            No files yet. Add the first link below.
          </p>
        ) : (
          rows.map((f) => (
            <div
              key={f.id}
              className="row between"
              style={{ alignItems: "center", gap: 8 }}
            >
              <a
                href={f.url}
                target="_blank"
                rel="noopener noreferrer"
                className="tlink"
                style={{
                  fontSize: 13,
                  flex: 1,
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {f.title}
              </a>
              <button
                type="button"
                aria-label={`Delete ${f.title}`}
                onClick={() => setConfirmDelete(f)}
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
            </div>
          ))
        )}

        <div
          style={{
            borderTop:
              rows.length === 0 ? undefined : "1px solid hsl(var(--border))",
            paddingTop: rows.length === 0 ? undefined : 12,
          }}
        >
          {!expanded ? (
            <button
              type="button"
              className="tlink"
              onClick={() => setExpanded(true)}
              style={{ fontSize: 13 }}
            >
              <IconPlus className="ic ic-sm" /> Add a link
            </button>
          ) : (
            <div className="stack-3">
              <input
                type="text"
                className="input"
                placeholder="Title (e.g. Floor Plan)"
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                disabled={saving}
                autoFocus
              />
              <input
                type="text"
                className="input"
                placeholder="URL (https://...)"
                value={urlDraft}
                onChange={(e) => setUrlDraft(e.target.value)}
                disabled={saving}
              />
              <div
                className="row"
                style={{ justifyContent: "flex-end", gap: 8 }}
              >
                <button
                  type="button"
                  className="btn btn-tertiary btn-sm"
                  onClick={() => {
                    setExpanded(false);
                    setTitleDraft("");
                    setUrlDraft("");
                  }}
                  disabled={saving}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={handleAdd}
                  disabled={
                    saving || !titleDraft.trim() || !urlDraft.trim() || !currentUserId
                  }
                >
                  {saving ? "Saving..." : "Save"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <AlertDialog
        open={Boolean(confirmDelete)}
        onOpenChange={(v) => !v && setConfirmDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this file link?</AlertDialogTitle>
            <AlertDialogDescription>
              Removes the link from this venue. Cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmDelete && handleDelete(confirmDelete)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
