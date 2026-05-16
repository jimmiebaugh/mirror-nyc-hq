import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useUserRole } from "@/hooks/useUserRole";
import { IconPencil, IconX } from "@/components/icons/HQIcons";
import { WikiLayout } from "@/components/wiki/WikiLayout";
import { WikiProseRenderer } from "@/components/wiki/WikiProseRenderer";
import { TeamDirectoryEmbed } from "@/components/wiki/TeamDirectoryEmbed";
import { VendorsGlanceEmbed } from "@/components/wiki/VendorsGlanceEmbed";
import { AccountLoginsPage } from "@/pages/wiki/AccountLoginsPage";
import {
  isSpecialPageType,
  loadWikiPageBySlug,
  loadWikiPages,
  type WikiPage as WikiPageRow,
  type WikiPageWithUpdater,
} from "@/lib/wiki/queries";
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

/**
 * Routes:
 *   /wiki                -> renders the first page by sort_order
 *   /wiki/:slug          -> renders the matching page (prose, team_directory,
 *                           vendors_glance, or account_logins)
 *
 * Auth: route is gated by <ProtectedRoute> (all tiers including freelance).
 * The `account_logins` page type has component-level + RLS protection that
 * blocks freelance users; visibility = 'no_freelance' also hides it from
 * the nav for freelance entirely.
 */
export default function WikiPage() {
  const { slug } = useParams<{ slug?: string }>();
  const navigate = useNavigate();
  const { isAdmin, isFreelance } = useUserRole();

  const [pages, setPages] = useState<WikiPageRow[]>([]);
  const [pagesLoading, setPagesLoading] = useState(true);
  const [page, setPage] = useState<WikiPageWithUpdater | null>(null);
  const [pageLoading, setPageLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Load full nav list.
  useEffect(() => {
    let active = true;
    setPagesLoading(true);
    loadWikiPages().then((p) => {
      if (active) {
        setPages(p);
        setPagesLoading(false);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  // Resolve the slug (or fall back to the first page visible to this user).
  const resolvedSlug = useMemo(() => {
    if (slug) return slug;
    const visible = pages.filter((p) => {
      if (p.visibility === "admin_only" && !isAdmin) return false;
      if (p.visibility === "no_freelance" && isFreelance) return false;
      return true;
    });
    return visible[0]?.slug ?? null;
  }, [slug, pages, isAdmin, isFreelance]);

  // Load the active page.
  useEffect(() => {
    if (!resolvedSlug) {
      setPageLoading(false);
      return;
    }
    let active = true;
    setPageLoading(true);
    setNotFound(false);
    loadWikiPageBySlug(resolvedSlug).then((p) => {
      if (!active) return;
      if (!p) {
        setNotFound(true);
        setPage(null);
      } else {
        setPage(p);
      }
      setPageLoading(false);
    });
    return () => {
      active = false;
    };
  }, [resolvedSlug]);

  if (pagesLoading) {
    return (
      <div className="empty">
        <p>Loading wiki...</p>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="empty">
        <p>Page not found.</p>
        <Link to="/wiki" className="btn btn-secondary btn-sm" style={{ marginTop: 16 }}>
          Back to Wiki
        </Link>
      </div>
    );
  }

  const isSpecial = page && page.page_type !== "prose";
  const showEditButton = isAdmin && page && page.page_type === "prose";
  const showDeleteButton =
    isAdmin && page && !isSpecialPageType(page.page_type);

  // Plain function, not useCallback — hooks must not sit after the early
  // returns above (would change render-to-render hook count and crash).
  // The dialog's onClick is the only caller, so memoization is unnecessary.
  const onDelete = async () => {
    if (!page) return;
    setDeleting(true);
    const { error } = await supabase
      .from("wiki_pages")
      .delete()
      .eq("id", page.id);
    setDeleting(false);
    setConfirmDeleteOpen(false);
    if (error) {
      toast({
        title: "Delete failed",
        description: error.message,
        variant: "destructive",
      });
      return;
    }
    toast({ title: `"${page.title}" deleted` });
    navigate("/wiki", { replace: true });
  };

  return (
    <div className="stack-4">
      <div className="pagehead">
        <div className="row between">
          <div>
            <div className="eyebrow">Team Wiki</div>
            <h1 className="h-page" style={{ marginTop: 4 }}>
              {page?.title ?? "Wiki"}
            </h1>
          </div>
          <div className="row-c" style={{ gap: 8 }}>
            {showEditButton ? (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => navigate(`/wiki/${page!.slug}/edit`)}
              >
                <IconPencil className="ic" />
                Edit Page
              </button>
            ) : null}
            {showDeleteButton ? (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setConfirmDeleteOpen(true)}
                style={{
                  color: "hsl(var(--destructive))",
                  borderColor: "rgba(239,68,68,.4)",
                }}
              >
                <IconX className="ic" />
                Delete Page
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <WikiLayout
        pages={pages}
        isAdmin={isAdmin}
        isFreelance={isFreelance}
        currentSlug={resolvedSlug}
      >
        <div
          className={`wikipage ${page?.page_type === "prose" ? "prose" : ""}`}
          style={isSpecial ? { maxWidth: "none" } : undefined}
        >
          {pageLoading ? (
            <p className="cap" style={{ textAlign: "center", padding: "48px 0" }}>
              Loading page...
            </p>
          ) : page ? (
            <PageContent
              page={page}
              isAdmin={isAdmin}
              isFreelance={isFreelance}
            />
          ) : null}
        </div>
      </WikiLayout>

      <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{page?.title}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This wiki page will be permanently removed. Anyone with the link
              will get a "page not found" view.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={onDelete} disabled={deleting}>
              {deleting ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function PageContent({
  page,
  isAdmin,
  isFreelance,
}: {
  page: WikiPageWithUpdater;
  isAdmin: boolean;
  isFreelance: boolean;
}) {
  // Visibility gate: admin_only blocks non-admins; no_freelance blocks
  // freelance. Direct slug nav still has to pass this check.
  if (page.visibility === "admin_only" && !isAdmin) {
    return (
      <div className="empty" style={{ marginTop: 16 }}>
        <p>You don't have access to this page.</p>
      </div>
    );
  }
  if (page.page_type === "team_directory") return <TeamDirectoryEmbed />;
  if (page.page_type === "vendors_glance") return <VendorsGlanceEmbed />;
  if (page.page_type === "account_logins") {
    if (isFreelance) {
      return (
        <div className="empty" style={{ marginTop: 16 }}>
          <p>You don't have access to this page.</p>
        </div>
      );
    }
    // canWrite: any non-freelance user can add/edit/delete credentials
    // (Phase 5.4 feedback round 2). Freelance never reaches this branch.
    return <AccountLoginsPage canWrite />;
  }
  // prose
  return (
    <>
      <WikiProseRenderer body={page.body} />
      {page.updated_by_full_name ? (
        <p className="cap" style={{ marginTop: 18 }}>
          Last edited by {page.updated_by_full_name} ·{" "}
          {new Date(page.updated_at).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          })}
        </p>
      ) : null}
    </>
  );
}
