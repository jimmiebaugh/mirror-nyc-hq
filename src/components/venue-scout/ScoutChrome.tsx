// Phase 4.9-port: shared per-scout chrome used by every action page in the
// Venue Scout flow. The phase-stepper now lives in `ScoutPhaseBreadcrumb`
// (src/components/venue-scout/ScoutPhaseBreadcrumb.tsx); only the gear-icon
// right-slot affordance lives here.
//
//   <ScoutSettingsLink scoutId={id} />
//     Right-slot gear icon. Always visible. Routes to
//     /venue-scout/scouts/:id/settings.
import { Link } from "react-router-dom";
import { Settings } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ScoutSettingsLink({ scoutId }: { scoutId: string }) {
  return (
    <Link to={`/venue-scout/scouts/${scoutId}/settings`} title="Scout settings">
      <Button variant="outline" size="icon" aria-label="Scout settings">
        <Settings className="h-4 w-4" />
      </Button>
    </Link>
  );
}
