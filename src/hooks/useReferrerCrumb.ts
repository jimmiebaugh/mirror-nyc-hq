// Phase 5.12.14.1 Stage 2C: unified app-wide back-crumb primitive.
//
// Three-layer priority:
//   1. `location.state.from` (explicit "from" pushed by a list-page navigator
//      so the back crumb returns to a filtered view with search preserved).
//   2. sessionStorage referrer (auto-tracked on every route change; gives a
//      "Back to {wherever you came from}" crumb on direct-load / refresh /
//      non-opt-in nav).
//   3. caller-provided `fallback` prop OR canonical-parent fallback from the
//      route table when no fallback is passed.
//
// Loop protection (load-bearing): every write checks the stored value isn't
// already the current pathname (a refresh on the same page shouldn't shift
// the referrer to point at itself), and every read drops the stored value
// when it matches the current pathname.
//
// sessionStorage scope is per-tab, so multi-tab producers don't bleed
// referrer state across tabs. Cross-tier nav (HQ Core ↔ VS) is fine — the
// resolveRoute table covers both, so the crumb says "Back to Project"
// when you came from /projects/abc and "Back to Scout" when you came
// from /venue-scout/scouts/xyz.

import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

const STORAGE_KEY = "app.referrer";

// R7 amendment v4 § 2: stage-aware crumb for BriefReport. Originally lived
// inside BriefReport itself; pulled into the hook so the TopBar's global
// crumb rendering picks up the dynamic routing without round-tripping
// state from the page. Mapping mirrors the pre-R7 amendment v3
// resolveBriefReportCrumb behavior — BriefReport is a hub, and its back-
// tap should route to whatever phase the producer most recently completed
// rather than the canonical-parent fallback (which always says Brief Venue).
function resolveBriefReportDynamicCrumb(
  scoutId: string,
  currentStep: string | null,
): { to: string; label: string } | null {
  const prefix = `/venue-scout/scouts/${scoutId}`;
  switch (currentStep) {
    case "completed":
      return { to: `${prefix}/review`, label: "Review" };
    case "compiling":
    case "deck_prep":
    case "review_selects":
      return { to: `${prefix}/sourcing/shortlist`, label: "Shortlist" };
    case "shortlist":
      return { to: `${prefix}/sourcing/report`, label: "Sourcing" };
    case "brief":
    case "sheet_prompt":
    case "sheet_upload":
    case "researching":
    case "sourcing_report":
      return { to: `${prefix}/brief/venue`, label: "Brief Intake" };
    default:
      // null / unknown step → fall through to canonical-parent fallback
      // (callers treat null return as "no dynamic override").
      return null;
  }
}

type RouteInfo = {
  // Human-readable label producers see in the crumb.
  label: string;
  // Canonical parent href + label used as the level-3 fallback when no
  // referrer is stored and no caller `fallback` prop is provided.
  canonicalParent: string;
  canonicalParentLabel: string;
};

export type BackFromState = {
  pathname: string;
  search?: string;
  label?: string;
};

/**
 * Build a `state.from` object to push on navigation so the destination
 * page's back crumb routes back to the originating list (preserving any
 * filter / search query params).
 *
 *   navigate(`/projects/${id}`, {
 *     state: { from: backState(location, "Projects") },
 *   });
 */
export function backState(
  location: { pathname: string; search?: string },
  label: string,
): BackFromState {
  return {
    pathname: location.pathname,
    search: location.search ?? "",
    label,
  };
}

// Maps a pathname to its label + canonical parent. Unknown paths return
// the safest default (parent = "/"). Detail patterns key off /:id suffixes.
function resolveRoute(pathname: string): RouteInfo {
  const p =
    pathname.endsWith("/") && pathname !== "/"
      ? pathname.slice(0, -1)
      : pathname;

  // HQ root + top-level list pages.
  if (p === "/" || p === "") {
    return { label: "HQ", canonicalParent: "/", canonicalParentLabel: "HQ" };
  }
  if (p === "/projects") {
    return { label: "Projects", canonicalParent: "/", canonicalParentLabel: "HQ" };
  }
  if (p === "/clients") {
    return { label: "Clients", canonicalParent: "/", canonicalParentLabel: "HQ" };
  }
  if (p === "/vendors") {
    return { label: "Vendors", canonicalParent: "/", canonicalParentLabel: "HQ" };
  }
  if (p === "/venues") {
    return { label: "Venues", canonicalParent: "/", canonicalParentLabel: "HQ" };
  }
  if (p === "/people") {
    return { label: "People", canonicalParent: "/", canonicalParentLabel: "HQ" };
  }
  if (p === "/tasks") {
    return { label: "Tasks", canonicalParent: "/", canonicalParentLabel: "HQ" };
  }
  if (p === "/deliverables") {
    return { label: "Deliverables", canonicalParent: "/", canonicalParentLabel: "HQ" };
  }
  if (p === "/calendar") {
    return { label: "Calendar", canonicalParent: "/", canonicalParentLabel: "HQ" };
  }

  // Settings + sub-surfaces.
  if (p === "/settings") {
    return { label: "Settings", canonicalParent: "/", canonicalParentLabel: "HQ" };
  }
  if (p === "/settings/profile") {
    return {
      label: "Profile settings",
      canonicalParent: "/settings",
      canonicalParentLabel: "Settings",
    };
  }
  if (p === "/settings/profile/notifications") {
    return {
      label: "Notification Preferences",
      canonicalParent: "/settings/profile",
      canonicalParentLabel: "Profile settings",
    };
  }
  if (p === "/settings/bulk-import" || p === "/settings/bulk-import/history") {
    return {
      label: "Bulk Import",
      canonicalParent: "/settings",
      canonicalParentLabel: "Settings",
    };
  }
  if (p.startsWith("/settings/bulk-import/")) {
    return {
      label: "Bulk Import",
      canonicalParent: "/settings",
      canonicalParentLabel: "Settings",
    };
  }

  // HQ Core detail pages — single-segment `/:id` after the entity.
  const projectMatch = p.match(/^\/projects\/([^/]+)$/);
  if (projectMatch) {
    return { label: "Project", canonicalParent: "/projects", canonicalParentLabel: "Projects" };
  }
  const clientMatch = p.match(/^\/clients\/([^/]+)$/);
  if (clientMatch) {
    return { label: "Client", canonicalParent: "/clients", canonicalParentLabel: "Clients" };
  }
  const vendorMatch = p.match(/^\/vendors\/([^/]+)$/);
  if (vendorMatch) {
    return { label: "Vendor", canonicalParent: "/vendors", canonicalParentLabel: "Vendors" };
  }
  const venueMatch = p.match(/^\/venues\/([^/]+)$/);
  if (venueMatch) {
    return { label: "Venue", canonicalParent: "/venues", canonicalParentLabel: "Venues" };
  }
  const personMatch = p.match(/^\/people\/([^/]+)$/);
  if (personMatch) {
    return { label: "Person", canonicalParent: "/people", canonicalParentLabel: "People" };
  }
  const taskMatch = p.match(/^\/tasks\/([^/]+)$/);
  if (taskMatch) {
    return { label: "Task", canonicalParent: "/tasks", canonicalParentLabel: "Tasks" };
  }
  const deliverableMatch = p.match(/^\/deliverables\/([^/]+)$/);
  if (deliverableMatch) {
    return { label: "Deliverable", canonicalParent: "/deliverables", canonicalParentLabel: "Deliverables" };
  }

  // VS top-level surfaces.
  if (p === "/venue-scout") {
    return { label: "Venue Scout", canonicalParent: "/home", canonicalParentLabel: "Home" };
  }
  if (p === "/venue-scout/overview") {
    return {
      label: "Overview",
      canonicalParent: "/venue-scout",
      canonicalParentLabel: "Venue Scout",
    };
  }
  if (p === "/venue-scout/settings") {
    return {
      label: "Venue Scout Settings",
      canonicalParent: "/venue-scout",
      canonicalParentLabel: "Venue Scout",
    };
  }
  if (p === "/venue-scout/scouts/new") {
    return {
      label: "New Scout",
      canonicalParent: "/venue-scout",
      canonicalParentLabel: "Venue Scout",
    };
  }

  // VS per-scout surfaces.
  const scoutMatch = p.match(/^\/venue-scout\/scouts\/([^/]+)(\/.*)?$/);
  const scoutId = scoutMatch?.[1] ?? null;
  const rest = scoutMatch?.[2] ?? "";
  if (scoutId) {
    const idPrefix = `/venue-scout/scouts/${scoutId}`;
    switch (rest) {
      case "":
      case "/brief":
      case "/brief/event":
        return {
          label: "Brief Event",
          canonicalParent: "/venue-scout",
          canonicalParentLabel: "Venue Scout",
        };
      case "/brief/venue":
        return {
          label: "Brief Venue",
          canonicalParent: `${idPrefix}/brief/event`,
          canonicalParentLabel: "Brief Event",
        };
      case "/brief/report":
        return {
          label: "Brief Report",
          canonicalParent: `${idPrefix}/brief/venue`,
          canonicalParentLabel: "Brief Venue",
        };
      case "/settings":
        return {
          label: "Scout Settings",
          canonicalParent: "/venue-scout",
          canonicalParentLabel: "Venue Scout",
        };
      case "/sourcing/sheet-prompt":
      case "/sourcing/sheet-upload":
        return {
          label: "Sourcing Sheet",
          canonicalParent: `${idPrefix}/brief/report`,
          canonicalParentLabel: "Brief Report",
        };
      case "/sourcing/researching":
        return {
          label: "Researching",
          canonicalParent: `${idPrefix}/sourcing/sheet-prompt`,
          canonicalParentLabel: "Sourcing Sheet",
        };
      case "/sourcing/report":
        return {
          label: "Sourcing Report",
          // Preceding-step model: SourcingReport routes back to BriefReport
          // (skips sheet-prompt + researching which are non-interactive).
          canonicalParent: `${idPrefix}/brief/report`,
          canonicalParentLabel: "Brief",
        };
      case "/sourcing/shortlist":
        return {
          label: "Shortlist",
          canonicalParent: `${idPrefix}/sourcing/report`,
          canonicalParentLabel: "Sourcing",
        };
      case "/sourcing/compiling":
        return {
          label: "Compiling",
          canonicalParent: `${idPrefix}/sourcing/shortlist`,
          canonicalParentLabel: "Shortlist",
        };
      case "/review":
        return {
          label: "Review",
          canonicalParent: `${idPrefix}/sourcing/shortlist`,
          canonicalParentLabel: "Shortlist",
        };
      case "/deck/generating":
        return {
          label: "Generating",
          canonicalParent: `${idPrefix}/review`,
          canonicalParentLabel: "Review",
        };
    }
    if (rest.startsWith("/sourcing/error/")) {
      return {
        label: "Error",
        canonicalParent: `${idPrefix}/sourcing/sheet-prompt`,
        canonicalParentLabel: "Sourcing Sheet",
      };
    }
    if (rest.startsWith("/deck/error/")) {
      return {
        label: "Error",
        canonicalParent: `${idPrefix}/review`,
        canonicalParentLabel: "Review",
      };
    }
    return {
      label: "Scout",
      canonicalParent: "/venue-scout",
      canonicalParentLabel: "Venue Scout",
    };
  }

  // TS top-level + settings.
  if (p === "/talent-scout") {
    return { label: "Talent Scout", canonicalParent: "/home", canonicalParentLabel: "Home" };
  }
  if (p === "/talent-scout/settings") {
    return { label: "TS Settings", canonicalParent: "/talent-scout", canonicalParentLabel: "Talent Scout" };
  }

  // TS per-role surfaces.
  const tsRoleMatch = p.match(/^\/talent-scout\/roles\/([^/]+)(\/.*)?$/);
  const tsRoleId = tsRoleMatch?.[1] ?? null;
  const tsRest = tsRoleMatch?.[2] ?? "";
  if (tsRoleId) {
    const idPrefix = `/talent-scout/roles/${tsRoleId}`;
    if (tsRest === "") {
      return { label: "Role", canonicalParent: "/talent-scout", canonicalParentLabel: "Talent Scout" };
    }
    if (tsRest === "/settings") {
      return { label: "Role Settings", canonicalParent: idPrefix, canonicalParentLabel: "Role" };
    }
    if (tsRest === "/final-review") {
      return { label: "Final Review", canonicalParent: idPrefix, canonicalParentLabel: "Role" };
    }
    if (tsRest.startsWith("/pulls/")) {
      return { label: "Pull Round", canonicalParent: idPrefix, canonicalParentLabel: "Role" };
    }
    const generatingMatch = tsRest.match(/^\/final-review\/([^/]+)\/generating$/);
    if (generatingMatch) {
      return { label: "Generating", canonicalParent: `${idPrefix}/final-review/${generatingMatch[1]}`, canonicalParentLabel: "Review" };
    }
    const reviewMatch = tsRest.match(/^\/final-review\/([^/]+)$/);
    if (reviewMatch) {
      return { label: "Review", canonicalParent: idPrefix, canonicalParentLabel: "Role" };
    }
    return { label: "Role", canonicalParent: "/talent-scout", canonicalParentLabel: "Talent Scout" };
  }

  // TS candidates.
  const tsCandidateMatch = p.match(/^\/talent-scout\/candidates\/([^/]+)$/);
  if (tsCandidateMatch) {
    return { label: "Candidate", canonicalParent: "/talent-scout", canonicalParentLabel: "Talent Scout" };
  }

  // Default fallback for any unmapped pathname.
  return { label: "HQ", canonicalParent: "/", canonicalParentLabel: "HQ" };
}

export function useReferrerCrumb(opts?: {
  fallback?: { to: string; label: string };
}): { label: string; href: string } {
  const location = useLocation();
  const { pathname } = location;

  // R7 amendment v4 § 2: dynamic crumb routing for BriefReport. When the
  // current path is `/venue-scout/scouts/:id/brief/report` we fetch the
  // scout's current_step + return a route based on the latest completed
  // phase (Sourcing / Shortlist / Review / Brief Intake). Only fires on
  // that one route; every other page skips the supabase query (the
  // useEffect short-circuits when briefReportScoutId is null).
  const briefReportMatch = pathname.match(
    /^\/venue-scout\/scouts\/([^/]+)\/brief\/report\/?$/,
  );
  const briefReportScoutId = briefReportMatch?.[1] ?? null;
  const [briefReportStep, setBriefReportStep] = useState<string | null>(null);

  useEffect(() => {
    if (!briefReportScoutId) {
      setBriefReportStep(null);
      return;
    }
    let active = true;
    supabase
      .from("vs_scouts")
      .select("current_step")
      .eq("id", briefReportScoutId)
      .maybeSingle()
      .then(({ data }) => {
        if (!active) return;
        setBriefReportStep(
          (data?.current_step as string | null) ?? null,
        );
      });
    return () => {
      active = false;
    };
  }, [briefReportScoutId]);

  // Read sessionStorage synchronously during render so the result reflects
  // the WRITE from the previous route's effect (which sets the prior path
  // as the new referrer after that render commits). Strict-mode's double-
  // render in dev is safe because the effect early-returns when the stored
  // value already matches the current path.
  let stored: string | null = null;
  try {
    stored = window.sessionStorage.getItem(STORAGE_KEY);
  } catch {
    stored = null;
  }

  useEffect(() => {
    if (stored === pathname) return;
    try {
      window.sessionStorage.setItem(STORAGE_KEY, pathname);
    } catch {
      // Private mode or storage disabled: behave like no-referrer.
    }
  }, [pathname, stored]);

  // VS-side scope: every Venue Scout page uses the canonical-parent
  // (preceding-step) fallback exclusively, NOT the sessionStorage
  // referrer + NOT `state.from`. Rationale (Jimmie 2026-05-25): VS is a
  // linear scout flow, not a graph; the producer wants the crumb to
  // always point at the previous logical step, not "wherever I came from
  // last." HQ Core keeps the full three-layer resolution below.
  const isVsPath = pathname.startsWith("/venue-scout");
  if (isVsPath) {
    // R7 amendment v4 § 2: BriefReport stage-aware override. When we're
    // on /brief/report AND the scout's current_step resolves to a known
    // phase, route to the latest-completed-phase target instead of the
    // canonical-parent fallback (which would always say Brief Venue).
    if (briefReportScoutId) {
      const dynamicCrumb = resolveBriefReportDynamicCrumb(
        briefReportScoutId,
        briefReportStep,
      );
      if (dynamicCrumb) {
        return {
          label: `Back to ${dynamicCrumb.label}`,
          href: dynamicCrumb.to,
        };
      }
    }
    if (opts?.fallback) {
      return {
        label: `Back to ${opts.fallback.label}`,
        href: opts.fallback.to,
      };
    }
    const currentInfo = resolveRoute(pathname);
    return {
      label: `Back to ${currentInfo.canonicalParentLabel}`,
      href: currentInfo.canonicalParent,
    };
  }

  // HQ Core resolution below.
  // Priority 1: explicit `state.from` (list-page filtered view with search).
  const fromState = (location.state as { from?: BackFromState } | null)?.from;
  if (fromState?.pathname) {
    return {
      href: fromState.pathname + (fromState.search ?? ""),
      label: `Back to ${fromState.label ?? "previous"}`,
    };
  }

  // Priority 2: sessionStorage-tracked referrer (auto-tracked).
  if (stored && stored !== pathname) {
    const referrerInfo = resolveRoute(stored);
    return { label: `Back to ${referrerInfo.label}`, href: stored };
  }

  // Priority 3a: caller-provided fallback override.
  if (opts?.fallback) {
    return {
      label: `Back to ${opts.fallback.label}`,
      href: opts.fallback.to,
    };
  }

  // Priority 3b: canonical-parent fallback from the route table.
  const currentInfo = resolveRoute(pathname);
  return {
    label: `Back to ${currentInfo.canonicalParentLabel}`,
    href: currentInfo.canonicalParent,
  };
}
