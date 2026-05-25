/**
 * Phase 5.12.12: resolve the rail nav Settings link's target for the
 * HQ + TS contexts. VS context bypasses this helper because the VS
 * rail group (VS_TOOL_ITEMS in LeftRail.tsx) hardcodes the Settings
 * entry to /venue-scout/settings.
 *
 * - /talent-scout/*  -> /talent-scout/settings
 * - everything else  -> /settings (HQ admin)
 */
export function resolveSettingsHref(pathname: string): string {
  if (pathname.startsWith("/talent-scout")) return "/talent-scout/settings";
  return "/settings";
}
