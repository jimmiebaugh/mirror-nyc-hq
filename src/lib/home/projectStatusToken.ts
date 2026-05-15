/**
 * Phase 5.1 status -> design-system token map.
 *
 * Source: docs/design-system.md § 5b "Status color mapping (canonical)".
 * Project status enum has 14 values; the shipped Postgres enum still uses a
 * partial subset of those labels. The map below covers both the shipped
 * labels and the locked Phase 5 names so it works on existing data plus any
 * 5.2 schema reshape.
 *
 * Returned token is one of `info | success | warn | destructive | muted`,
 * which maps 1:1 to the `.hq-pill--<token>` classes in src/index.css. Use
 * `hqPillClass(status)` for the pill wrapper.
 */

export type StatusToken = "info" | "success" | "warn" | "destructive" | "muted";

const PROJECT_STATUS_TOKENS: Record<string, StatusToken> = {
  // Locked Phase 5 labels per spec § 5a + locked-decisions § 4
  Approved: "success",
  "In Production": "info",
  "In Progress": "info",
  "Location Scouting": "info",
  Install: "info",
  Removal: "warn",
  Billing: "warn",
  Queued: "muted",
  Quoting: "warn",
  "Quote Sent": "warn",
  "Awaiting Feedback": "warn",
  "On Hold": "muted",
  Complete: "muted",
  Cancelled: "destructive",
  // Shipped enum aliases that survive into 5.1 until 5.2 reshapes the enum
  "Awaiting FB": "warn",
  "Awaiting Files": "warn",
  "Awaiting Approval": "warn",
  "Event Live": "info",
  "Proof Out": "warn",
  "In Review": "info",
};

export function projectStatusToken(status: string | null | undefined): StatusToken {
  if (!status) return "muted";
  return PROJECT_STATUS_TOKENS[status] ?? "muted";
}

export function hqPillClass(status: string | null | undefined) {
  return `hq-pill hq-pill--${projectStatusToken(status)}`;
}

const TASK_STATUS_TOKENS: Record<string, StatusToken> = {
  todo: "muted",
  in_progress: "info",
  blocked: "destructive",
  done: "success",
};

export function taskStatusToken(status: string | null | undefined): StatusToken {
  if (!status) return "muted";
  return TASK_STATUS_TOKENS[status] ?? "muted";
}

export function taskStatusLabel(status: string | null | undefined): string {
  switch (status) {
    case "todo": return "To Do";
    case "in_progress": return "Doing";
    case "blocked": return "Blocked";
    case "done": return "Done";
    default: return status ?? "";
  }
}