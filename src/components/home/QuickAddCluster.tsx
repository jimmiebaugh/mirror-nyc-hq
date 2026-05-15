import { useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { IconPlus } from "@/components/icons/HQIcons";

const ITEMS = [
  "New Project",
  "New Task",
  "New Deliverable",
  "New Person",
] as const;

/**
 * Phase 5.1 Quick-add cluster (spec § 7c).
 *
 * Four dashed-border chips. Each click opens an AlertDialog titled "Coming in
 * Phase 5.2" with a single "Got it" action. The affordance is visible so the
 * producer knows it's real and lands soon; the actual creation forms ship in
 * 5.2 alongside Projects + Tasks + Deliverables and 5.2 also handles People
 * (per locked decisions Q1).
 */
export function QuickAddCluster() {
  const [open, setOpen] = useState(false);
  const [pendingLabel, setPendingLabel] = useState<string | null>(null);

  const onClick = (label: string) => {
    setPendingLabel(label);
    setOpen(true);
  };

  return (
    <>
      <div className="hq-quickadd">
        {ITEMS.map((label) => (
          <button
            key={label}
            type="button"
            className="hq-qa"
            onClick={() => onClick(label)}
          >
            <IconPlus className="h-[14px] w-[14px]" />
            <span>{label}</span>
          </button>
        ))}
      </div>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Coming in Phase 5.2</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingLabel ?? "This action"} lands alongside the Projects, Tasks,
              Deliverables, and People surfaces in 5.2.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setOpen(false)}>Got it</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}