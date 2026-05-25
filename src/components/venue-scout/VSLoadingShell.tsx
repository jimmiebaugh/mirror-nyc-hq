// Audit pass 2 item 3: canonical Venue Scout loading shell.
//
// Replaces the three near-identical loading-page bodies on Researching /
// Compiling / Generating with one component. The previously page-local
// header (eyebrow + h-page) + spinning-circle + step list collapses to:
// breadcrumb -> animated icon (icon-as-spinner) -> centered title ->
// centered description -> step list driven by the parent-derived
// activeStepKey.
//
// Icon animation lives in `src/index.css` under three keyframe classes
// (`vs-loading-icon--pencil`, `vs-loading-icon--hammer`,
// `vs-loading-icon--magnifier`). Each respects the global
// `prefers-reduced-motion` guard at the bottom of index.css, which
// collapses animation-duration to 0.01ms so the icon reads as static.
//
// activeStepKey: parent owns the source of truth. Pre-Item-3-backend, the
// parent runs a setInterval timer that walks the keys. Post-Item-3-backend,
// the parent reads `scout?.brief_data?.progress_step` off the existing
// Realtime channel and falls back to `steps[0].key` when the field is
// absent. The shell is purely presentational.

import type { ReactNode } from "react";
import { Hammer, Pencil, Search } from "lucide-react";
import { ScoutPhaseBreadcrumb } from "@/components/venue-scout/ScoutPhaseBreadcrumb";
import { cn } from "@/lib/utils";

export type LoadingShellStep = { key: string; label: string };

export type LoadingShellIcon = "pencil" | "hammer" | "magnifying-glass";

const ICON_COMPONENT: Record<LoadingShellIcon, typeof Pencil> = {
  pencil: Pencil,
  hammer: Hammer,
  "magnifying-glass": Search,
};

const ICON_ANIMATION_CLASS: Record<LoadingShellIcon, string> = {
  pencil: "vs-loading-icon--pencil",
  hammer: "vs-loading-icon--hammer",
  "magnifying-glass": "vs-loading-icon--magnifier",
};

export function VSLoadingShell({
  scoutId,
  icon,
  title,
  description,
  steps,
  activeStepKey,
}: {
  scoutId: string;
  icon: LoadingShellIcon;
  title: string;
  description: ReactNode;
  steps: readonly LoadingShellStep[];
  activeStepKey: string;
}) {
  const Icon = ICON_COMPONENT[icon];
  // Resolve the active step. Falls back to step 0 when the key isn't
  // recognized (e.g., brief_data.progress_step holds a stale key from a
  // prior pipeline shape, or the field is missing entirely).
  const rawIdx = steps.findIndex((s) => s.key === activeStepKey);
  const activeIdx = rawIdx >= 0 ? rawIdx : 0;
  return (
    <div className="mx-auto max-w-3xl">
      <ScoutPhaseBreadcrumb scoutId={scoutId} />
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
        <Icon
          className={cn(
            "h-14 w-14 text-primary mb-8",
            ICON_ANIMATION_CLASS[icon],
          )}
          aria-hidden="true"
        />
        <h1 className="h-page">{title}</h1>
        <p className="text-sm text-muted-foreground mt-4 max-w-xl">
          {description}
        </p>
        <ul className="mt-10 space-y-3 text-sm text-left">
          {steps.map((s, i) => {
            const done = i < activeIdx;
            const current = i === activeIdx;
            return (
              <li key={s.key} className="flex items-center gap-3">
                <span
                  className={cn(
                    "inline-flex h-2.5 w-2.5 rounded-full",
                    done
                      ? "bg-success"
                      : current
                        ? "bg-primary animate-pulse"
                        : "bg-border",
                  )}
                />
                <span
                  className={cn(
                    current
                      ? "font-semibold text-foreground"
                      : done
                        ? "text-muted-foreground"
                        : "text-muted-foreground/60",
                  )}
                >
                  {s.label}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
