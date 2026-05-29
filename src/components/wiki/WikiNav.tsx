import { Link, useLocation } from "react-router-dom";
import { IconLink, IconLock, IconPlus } from "@/components/icons/HQIcons";
import { type WikiPage } from "@/lib/wiki/queries";

/**
 * Wiki sidebar nav. Lists pages sorted by sort_order. Special page types
 * (team_directory / vendors_glance) get a link glyph; admin_only pages get
 * a lock glyph and are hidden from non-admins (the nav is rendered then
 * filtered, so even the link doesn't show up).
 *
 * Admin users see a "+ New Page" affordance at the bottom.
 */
export function WikiNav({
  pages,
  isAdmin,
  currentSlug,
}: {
  pages: WikiPage[];
  isAdmin: boolean;
  currentSlug: string | null;
}) {
  const { pathname } = useLocation();
  const visible = pages.filter((p) => {
    if (p.visibility === "admin_only" && !isAdmin) return false;
    return true;
  });

  return (
    <nav className="wikinav">
      {visible.map((p) => {
        const active = currentSlug === p.slug || pathname === `/wiki/${p.slug}`;
        const showLockGlyph = p.visibility === "admin_only";
        const showLinkGlyph =
          p.page_type === "team_directory" || p.page_type === "vendors_glance";
        return (
          <Link
            key={p.id}
            to={`/wiki/${p.slug}`}
            className={`wn ${active ? "wn--active" : ""}`}
          >
            {showLockGlyph ? (
              <IconLock
                className="ic ic-sm"
                style={{ width: 11, height: 11, color: "#4a4a4a" }}
              />
            ) : null}
            <span>{p.title}</span>
            {showLinkGlyph ? <IconLink className="lk" /> : null}
          </Link>
        );
      })}
      {isAdmin ? (
        <Link
          to="/wiki/new"
          className="wn"
          style={{ marginTop: 12, color: "hsl(var(--primary))" }}
        >
          <IconPlus className="ic" style={{ width: 12, height: 12 }} />
          <span>New Page</span>
        </Link>
      ) : null}
    </nav>
  );
}
