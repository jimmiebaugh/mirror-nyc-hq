import { useLocation } from "react-router-dom";

/**
 * Phase 5.6.2.1: history-aware back crumb. Detail pages used to hardcode
 * the back link to their root list (e.g. "Back to People"), even when the
 * user landed there from a different surface (clicking a person link
 * inside the Clients table). This hook reads `location.state.from` if the
 * navigator set one, else falls back to the surface's natural root.
 *
 * To opt in from a navigator (Link or programmatic navigate):
 *   <Link to={`/people/${id}`} state={{ from: backState(location, "Clients") }}>
 *   navigate(`/people/${id}`, { state: { from: backState(location, "Clients") } });
 *
 * The detail page reads via:
 *   const back = useBackHref({ to: "/people", label: "People" });
 *   <Link to={back.to}>Back to {back.label}</Link>
 */

export type BackFromState = {
  pathname: string;
  search?: string;
  label?: string;
};

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

export function useBackHref(fallback: { to: string; label: string }): {
  to: string;
  label: string;
} {
  const location = useLocation();
  const from = (location.state as { from?: BackFromState } | null)?.from;
  if (from?.pathname) {
    return {
      to: from.pathname + (from.search ?? ""),
      label: from.label ?? fallback.label,
    };
  }
  return fallback;
}
