// Phase 5.12.14.3 R7 amendment v2 § 5 → R7 amendment v3 § 3: shared
// scout-page top row.
//
// Layout (R7 amendment v3 § 3 — back-crumb moved into TopBar globally):
//   [ empty left ]   [ ScoutPhaseBreadcrumb (centered) ]   [ ScoutSettingsLink (right) ]
//
// The left zone is intentionally empty — the back-crumb that used to sit
// there now lives in the global TopBar (where it appears on every HQ
// page that has a meaningful parent route). Keeping the 3-col grid (vs
// switching to 2-col) preserves the "centered across page" intent for
// the ScoutPhaseBreadcrumb regardless of right-zone width.

import type { ReactNode } from "react";
import { ScoutPhaseBreadcrumb } from "@/components/venue-scout/ScoutPhaseBreadcrumb";
import { ScoutSettingsLink } from "@/components/venue-scout/ScoutChrome";

type ScoutMeta = { current_step: string | null } & Record<string, unknown>;

export type ScoutPageHeaderProps = {
  scoutId: string;
  /** Pass the loaded scout row (`scout` or `scoutMeta`) so the breadcrumb
   *  doesn't refetch. */
  scout?: ScoutMeta | null;
  /** Right-zone slot. Defaults to the per-scout settings gear icon. Pass
   *  `null` to leave the right zone empty. */
  right?: ReactNode;
};

export function ScoutPageHeader({
  scoutId,
  scout,
  right,
}: ScoutPageHeaderProps) {
  const rightSlot =
    right === undefined ? <ScoutSettingsLink scoutId={scoutId} /> : right;
  return (
    <div className="grid grid-cols-3 items-center gap-3 mb-4">
      <div className="justify-self-start min-w-0" />
      <div className="justify-self-center min-w-0">
        <ScoutPhaseBreadcrumb scoutId={scoutId} scout={scout} />
      </div>
      <div className="justify-self-end min-w-0">{rightSlot}</div>
    </div>
  );
}
