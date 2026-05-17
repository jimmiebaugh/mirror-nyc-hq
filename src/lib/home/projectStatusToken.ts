/**
 * Status -> design-system token map for the three HQ Core list enums.
 *
 * Source: docs/design-system.md § 5b "Status color mapping (canonical)".
 * Reshaped in Phase 5.2.1 to drop the legacy alias rows (Awaiting FB /
 * Files / Approval / Event Live / Proof Out / In Review); the Postgres
 * enum was rebuilt to the locked 14-value list in migration
 * 20260515130000_phase_5_2_1_project_task_enum_reshape.sql.
 *
 * Returned token is one of `info | success | warn | destructive | muted`,
 * which maps 1:1 to the `.hq-pill--<token>` classes in src/index.css. Use
 * `hqPillClass(status)` for the pill wrapper.
 */

export type StatusToken = "info" | "success" | "warn" | "destructive" | "muted" | "purple";

const PROJECT_STATUS_TOKENS: Record<string, StatusToken> = {
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
};

export function projectStatusToken(status: string | null | undefined): StatusToken {
  if (!status) return "muted";
  return PROJECT_STATUS_TOKENS[status] ?? "muted";
}

export function hqPillClass(status: string | null | undefined) {
  return `hq-pill hq-pill--${projectStatusToken(status)}`;
}

const TASK_STATUS_TOKENS: Record<string, StatusToken> = {
  "To Do": "warn",
  Doing: "purple",
  Blocked: "destructive",
  Done: "success",
};

export function taskStatusToken(status: string | null | undefined): StatusToken {
  if (!status) return "muted";
  return TASK_STATUS_TOKENS[status] ?? "muted";
}

const DELIVERABLE_STATUS_TOKENS: Record<string, StatusToken> = {
  Upcoming: "muted",
  "In Progress": "warn",
  Complete: "success",
  Skipped: "muted",
};

export function deliverableStatusToken(status: string | null | undefined): StatusToken {
  if (!status) return "muted";
  return DELIVERABLE_STATUS_TOKENS[status] ?? "muted";
}

const TASK_PRIORITY_TOKENS: Record<string, StatusToken> = {
  Urgent: "destructive",
  High: "warn",
  Normal: "info",
  Low: "muted",
};

export function taskPriorityToken(priority: string | null | undefined): StatusToken {
  if (!priority) return "muted";
  return TASK_PRIORITY_TOKENS[priority] ?? "muted";
}

const OUTLOOK_CONFIDENCE_TOKENS: Record<string, StatusToken> = {
  "On Radar": "warn",
  Likely: "info",
  Confirmed: "success",
  Complete: "muted",
};

export function outlookConfidenceToken(
  confidence: string | null | undefined,
): StatusToken {
  if (!confidence) return "muted";
  return OUTLOOK_CONFIDENCE_TOKENS[confidence] ?? "muted";
}

export const OUTLOOK_CONFIDENCE_VALUES = [
  "On Radar",
  "Likely",
  "Confirmed",
  "Complete",
] as const;

/**
 * Skipped deliverables and Done tasks render with strikethrough + reduced
 * opacity on the title text per locked-decisions § 4. Component code can
 * call this helper to derive the right class fragment.
 */
export function statusTextDecoration(
  entity: "task" | "deliverable",
  status: string | null | undefined,
): string {
  if (entity === "task" && status === "Done") return "line-through opacity-60";
  if (entity === "deliverable" && status === "Skipped") return "line-through opacity-60";
  return "";
}
