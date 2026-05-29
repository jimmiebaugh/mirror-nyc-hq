import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useUserRole } from "@/hooks/useUserRole";
import { useAuth } from "@/hooks/useAuth";
import { StickySaveBar } from "@/components/data/StickySaveBar";
import { WikiLayout } from "@/components/wiki/WikiLayout";
import { WikiEditor } from "@/components/wiki/WikiEditor";
import {
  isSpecialPageType,
  loadWikiPageBySlug,
  loadWikiPages,
  slugify,
  type WikiPage,
  type WikiVisibility,
} from "@/lib/wiki/queries";
import {
  cleanupRemovedWikiImages,
  extractWikiImagePaths,
  makeSessionUploadTracker,
} from "@/lib/wiki/images";
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
import { toast } from "@/hooks/use-toast";

type FormState = {
  title: string;
  slug: string;
  sortOrder: string;
  visibility: WikiVisibility;
  body: string;
};

const EMPTY: FormState = {
  title: "",
  slug: "",
  sortOrder: "",
  visibility: "all",
  body: "",
};

/**
 * Wiki page edit form. Admin-only (gated by <AdminRoute> in App.tsx).
 *
 * Routes: /wiki/new (create) or /wiki/:slug/edit (edit).
 *
 * Layout reuses the WikiLayout shell so the sidebar nav stays visible
 * while editing. The content slot is the form (title / slug / sort_order /
 * visibility / body) plus a markdown preview toggle. Sticky save bar at
 * the bottom matches the shipped pattern from ProjectEdit.
 *
 * Special pages (team_directory / vendors_glance / account_logins) seed
 * via migration only and cannot be edited or deleted from the UI.
 */
export default function WikiPageEdit() {
  const { slug: routeSlug } = useParams<{ slug?: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { isAdmin } = useUserRole();
  const isCreate = !routeSlug;

  const [allPages, setAllPages] = useState<WikiPage[]>([]);
  const [pageId, setPageId] = useState<string | null>(null);
  const [pageType, setPageType] = useState<WikiPage["page_type"]>("prose");
  const [initial, setInitial] = useState<FormState>(EMPTY);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [loading, setLoading] = useState(!isCreate);
  const [saving, setSaving] = useState(false);
  const [confirmLeaveOpen, setConfirmLeaveOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [slugTouched, setSlugTouched] = useState(false);
  // Tracks images uploaded during this edit session. Cleared on a
  // successful save; flushed on cancel / unmount so editor-only uploads
  // don't orphan in the wiki_images bucket.
  const sessionUploads = useRef(makeSessionUploadTracker()).current;

  useEffect(() => {
    let active = true;
    (async () => {
      const pages = await loadWikiPages();
      if (!active) return;
      setAllPages(pages);

      if (isCreate) {
        const maxSort = pages.reduce(
          (acc, p) => Math.max(acc, p.sort_order ?? 0),
          0,
        );
        const next: FormState = {
          ...EMPTY,
          sortOrder: String(maxSort + 1),
        };
        setForm(next);
        setInitial(next);
        setLoading(false);
        return;
      }

      const p = await loadWikiPageBySlug(routeSlug!);
      if (!active) return;
      if (!p) {
        toast({ title: "Page not found", variant: "destructive" });
        navigate("/wiki", { replace: true });
        return;
      }
      setPageId(p.id);
      setPageType(p.page_type);
      const next: FormState = {
        title: p.title,
        slug: p.slug,
        sortOrder: String(p.sort_order),
        visibility: p.visibility,
        body: p.body ?? "",
      };
      setForm(next);
      setInitial(next);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [routeSlug, isCreate, navigate]);

  const dirty = useMemo(
    () => JSON.stringify(form) !== JSON.stringify(initial),
    [form, initial],
  );

  // Auto-slug on create until the user touches the slug field.
  useEffect(() => {
    if (!isCreate || slugTouched) return;
    setForm((f) => ({ ...f, slug: slugify(f.title) }));
  }, [form.title, isCreate, slugTouched]);

  // Best-effort cleanup if the user navigates away without saving (covers
  // hard route changes that bypass the confirm dialog). Successful save
  // clears the tracker first, so this becomes a no-op in that path.
  useEffect(() => {
    return () => {
      void sessionUploads.cleanupAll();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onCancel = () => {
    if (!dirty) {
      navigate(routeSlug ? `/wiki/${routeSlug}` : "/wiki");
      return;
    }
    setConfirmLeaveOpen(true);
  };

  const validate = (): string | null => {
    if (!form.title.trim()) return "Title is required";
    if (!form.slug.trim()) return "Slug is required";
    if (!/^[a-z0-9-]+$/.test(form.slug))
      return "Slug must use lowercase letters, numbers, and hyphens only";
    const slugConflict = allPages.find(
      (p) => p.slug === form.slug && p.id !== pageId,
    );
    if (slugConflict) return `Slug "${form.slug}" is already in use`;
    const sortNum = Number(form.sortOrder);
    if (!Number.isFinite(sortNum)) return "Sort order must be a number";
    return null;
  };

  const onSave = async () => {
    const err = validate();
    if (err) {
      toast({ title: err, variant: "destructive" });
      return;
    }
    setSaving(true);
    const payload = {
      title: form.title.trim(),
      slug: form.slug.trim(),
      sort_order: Number(form.sortOrder),
      visibility: form.visibility,
      body: form.body.trim() ? form.body : null,
    };
    if (isCreate) {
      const { data, error } = await supabase
        .from("wiki_pages")
        .insert({
          ...payload,
          page_type: "prose",
          created_by: user?.id,
          updated_by: user?.id,
        })
        .select("slug")
        .single();
      setSaving(false);
      if (error) {
        toast({ title: "Save failed", description: error.message, variant: "destructive" });
        return;
      }
      // Successful save persists every uploaded-this-session file.
      sessionUploads.clear();
      toast({ title: "Page created" });
      navigate(`/wiki/${data.slug}`);
    } else {
      const { error } = await supabase
        .from("wiki_pages")
        .update({ ...payload, updated_by: user?.id })
        .eq("id", pageId!);
      setSaving(false);
      if (error) {
        toast({ title: "Save failed", description: error.message, variant: "destructive" });
        return;
      }
      // Diff old vs new body — delete files that left the HTML body.
      await cleanupRemovedWikiImages(initial.body, form.body);
      sessionUploads.clear();
      toast({ title: "Saved" });
      setInitial(form);
      // If slug changed, navigate to new url.
      if (form.slug !== routeSlug) {
        navigate(`/wiki/${form.slug}/edit`, { replace: true });
      }
    }
  };

  const onDelete = async () => {
    if (!pageId) return;
    const { error } = await supabase.from("wiki_pages").delete().eq("id", pageId);
    setConfirmDeleteOpen(false);
    if (error) {
      toast({ title: "Delete failed", description: error.message, variant: "destructive" });
      return;
    }
    // Sweep every image embedded in the deleted page's body, plus any
    // session-tracked uploads that never made it into the persisted body.
    const embedded = extractWikiImagePaths(form.body);
    if (embedded.length > 0) {
      const { error: storageErr } = await supabase.storage
        .from("wiki_images")
        .remove(embedded);
      if (storageErr) {
        console.warn("[wiki_images] page-delete cleanup failed", storageErr);
      }
    }
    await sessionUploads.cleanupAll();
    toast({ title: "Page deleted" });
    navigate("/wiki");
  };

  const canDelete = !isCreate && !isSpecialPageType(pageType);

  if (!isAdmin) {
    return (
      <div className="empty">
        <p>You don't have access to this page.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="empty">
        <p>Loading...</p>
      </div>
    );
  }

  return (
    <div className="stack-4 hq-form" style={{ paddingBottom: 120 }}>
      <div className="pagehead">
        <h1 className="h-page" style={{ marginTop: 4 }}>
          {isCreate ? "New Page" : "Edit Page"}
        </h1>
      </div>

      <WikiLayout
        pages={allPages}
        isAdmin={isAdmin}
        currentSlug={routeSlug ?? null}
      >
        <div className="wikipage" style={{ maxWidth: 760 }}>
          <section className="card">
            <div className="card-headbar">
              <span className="h-card">Page Details</span>
            </div>
            <div className="card-pad stack-4">
              <div className="g2">
                <div className="field">
                  <label className="label-form">Title<span className="req">*</span></label>
                  <input
                    className={`input ${form.title ? "input--filled" : ""}`}
                    value={form.title}
                    onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                    placeholder="Untitled"
                  />
                </div>
                <div className="field">
                  <label className="label-form">Slug<span className="req">*</span></label>
                  <input
                    className={`input ${form.slug ? "input--filled" : ""}`}
                    value={form.slug}
                    onChange={(e) => {
                      setSlugTouched(true);
                      setForm((f) => ({ ...f, slug: e.target.value }));
                    }}
                    placeholder="how-we-work"
                  />
                </div>
                <div className="field">
                  <label className="label-form">Sort Order</label>
                  <input
                    type="number"
                    className={`input ${form.sortOrder ? "input--filled" : ""}`}
                    value={form.sortOrder}
                    onChange={(e) => setForm((f) => ({ ...f, sortOrder: e.target.value }))}
                  />
                </div>
                <div className="field">
                  <label className="label-form">Visibility</label>
                  <select
                    className={`input ${form.visibility ? "input--filled" : ""}`}
                    value={form.visibility}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        visibility: e.target.value as WikiVisibility,
                      }))
                    }
                  >
                    <option value="all">Everyone</option>
                    <option value="admin_only">Admin Only</option>
                  </select>
                </div>
              </div>
            </div>
          </section>

          <section className="card" style={{ marginTop: 16 }}>
            <div className="card-headbar">
              <span className="h-card">Body</span>
            </div>
            <div className="card-pad stack-4">
              <WikiEditor
                value={form.body}
                onChange={(html) => setForm((f) => ({ ...f, body: html }))}
                onImageReady={(path) => sessionUploads.add(path)}
              />
            </div>
          </section>

          {canDelete ? (
            <div className="row between" style={{ marginTop: 16 }}>
              <button
                type="button"
                className="btn btn-tertiary"
                onClick={() => setConfirmDeleteOpen(true)}
                style={{ color: "hsl(var(--destructive))" }}
              >
                Delete Page
              </button>
            </div>
          ) : null}
        </div>
      </WikiLayout>

      <StickySaveBar
        dirty={dirty}
        saving={saving}
        onCancel={onCancel}
        onSave={onSave}
        saveLabel={isCreate ? "Create page" : "Save page"}
      />

      <AlertDialog open={confirmLeaveOpen} onOpenChange={setConfirmLeaveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
            <AlertDialogDescription>
              You have edits that haven't been saved. Leaving will lose them.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Stay</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                await sessionUploads.cleanupAll();
                navigate(routeSlug ? `/wiki/${routeSlug}` : "/wiki");
              }}
            >
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this page?</AlertDialogTitle>
            <AlertDialogDescription>
              "{form.title}" will be permanently removed from the wiki.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={onDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
