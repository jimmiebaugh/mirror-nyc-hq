import type { ReactNode } from "react";
import { WikiNav } from "./WikiNav";
import type { WikiPage } from "@/lib/wiki/queries";

/**
 * Wiki two-column shell. Sidebar nav on the left (220px), scrollable
 * content area on the right. Used by WikiPage (prose / embed) and by
 * AccountLoginsPage (the special slug `account-logins`).
 */
export function WikiLayout({
  pages,
  isAdmin,
  currentSlug,
  children,
}: {
  pages: WikiPage[];
  isAdmin: boolean;
  currentSlug: string | null;
  children: ReactNode;
}) {
  return (
    <div className="wikilayout">
      <WikiNav pages={pages} isAdmin={isAdmin} currentSlug={currentSlug} />
      {children}
    </div>
  );
}
