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
 * Phase 5.7.11: vendor Files & Assets card. URL + title list shared by
 * VendorDetail (read-write) and VendorEdit (read-write, !isCreate only).
 * Open-authenticated RLS per the 2026-05-18 simplification: every signed-in
 * user can SELECT/INSERT/DELETE; the confirm dialog is the only friction.
 *
 * Both INSERT and DELETE are server-confirmed (matches InternalNotesEditor).
 * State managed locally; not tied to VendorEdit's StickySaveBar dirty
 * tracking (adds commit immediately).
 */

type VendorFile = {
  id: string;
  title: string;
  url: string;
  created_by: string | null;
  created_at: string;
};

export function VendorFilesEditor({ vendorId }: { vendorId: string }) {
  const [rows, setRows] = useState<VendorFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [urlDraft, setUrlDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<VendorFile | null>(null);

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
    if (!vendorId) return;
    let active = true;
    setLoading(true);
    (async () => {
      const { data, error } = await supabase
        .from("vendor_files")
        .select("id, title, url, created_by, created_at")
        .eq("vendor_id", vendorId)
        .order("created_at", { ascending: false });
      if (!active) return;
      setLoading(false);
      if (error) {
        console.warn("vendor_files load failed", error);
        setRows([]);
        return;
      }
      setRows((data ?? []) as VendorFile[]);
    })();
    return () => {
      active = false;
    };
  }, [vendorId]);

  const handleAdd = async () => {
    const title = titleDraft.trim();
    const url = urlDraft.trim();
    if (!title || !url || !currentUserId) return;
    setSaving(true);
    const { data, error } = await supabase
      .from("vendor_files")
      .insert({
        vendor_id: vendorId,
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
    setRows((prev) => [data as VendorFile, ...prev]);
    setExpanded(false);
    setTitleDraft("");
    setUrlDraft("");
  };

  const handleDelete = async (f: VendorFile) => {
    const { error } = await supabase
      .from("vendor_files")
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
                placeholder="Title (e.g. Capabilities Deck)"
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
              Removes the link from this vendor. Cannot be undone.
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
