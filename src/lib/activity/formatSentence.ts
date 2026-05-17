import type { ReactNode } from "react";
import type { ActivityRow } from "./queries";

/**
 * Phase 5.5 activity-feed row sentence builder (spec § 5).
 *
 * Returns three pieces the page renders together with the row's icon dot:
 *   - actor:   {full_name | email | "Someone"} rendered as a who-link
 *   - link target: href for the record's detail page (or null when entity has
 *     no canonical detail page, e.g. notes_log)
 *   - body:    rest-of-sentence ReactNode (action verb + entity name + any
 *     field/status detail from payload). The bolded record name is up to the
 *     caller to wrap in a <Link> (per wireframe Rule: record names are coral
 *     clickable links; deliverable titles render as bold-foreground non-link).
 *
 * Payload shapes are heterogeneous because triggers across the surfaces
 * (`activity_log_writer` for projects/venues/tasks/deliverables, plus the
 * outlook + notes triggers) write different shapes. The formatter
 * pattern-matches on what's there and falls back to a generic
 * "{actor} {action} {entity}" when payload is unstructured.
 */

export type FormattedActivity = {
  actor: { id: string | null; name: string };
  recordName: string | null;
  recordHref: string | null;
  /** True when the record should render bold-foreground (not a link). */
  recordIsBoldOnly?: boolean;
  /** Prefix text rendered before the bold record name. */
  leadingText: string;
  /** Trailing text rendered after the bold record name. */
  trailingText?: string;
};

function actorDisplay(actor: ActivityRow["actor"]): { id: string | null; name: string } {
  if (!actor) return { id: null, name: "Someone" };
  const id = actor.id;
  if (actor.full_name?.trim()) return { id, name: actor.full_name };
  if (actor.email) return { id, name: actor.email.split("@")[0] };
  return { id, name: "Someone" };
}

/** activity_log_writer keys entity_type off TG_TABLE_NAME (plural). Every
 *  render-side switch is keyed singular. Normalize at the renderer boundary
 *  so existing rows render correctly without a backfill. Phase 5.7.2 sweep. */
function singularizeEntityType(t: string): string {
  switch (t) {
    case "projects":        return "project";
    case "tasks":           return "task";
    case "deliverables":    return "deliverable";
    case "venues":          return "venue";
    case "vendors":         return "vendor";
    case "clients":         return "client";
    case "people":          return "person";
    case "wiki_pages":      return "wiki_page";
    case "outlook_entries": return "outlook_entry";
    case "credentials":     return "credential";
    case "mirror_holidays": return "mirror_holiday";
    // Pre-5.2.3 organizations rows. Map to vendor per the 5.2.3 split lock.
    case "organizations":   return "vendor";
    default:                return t;
  }
}

function recordHrefFor(
  entityType: string,
  entityId: string,
  payload: Record<string, unknown> | null,
): string | null {
  switch (entityType) {
    case "project":
      return `/projects/${entityId}`;
    case "task":
      return `/tasks/${entityId}`;
    case "venue":
      return `/venues/${entityId}`;
    case "vendor":
    case "organization":
      return `/vendors/${entityId}`;
    case "client":
      return `/clients/${entityId}`;
    case "person":
      return `/people/${entityId}`;
    case "outlook_entry":
      return `/outlook`;
    case "wiki_page": {
      const slug = (payload?.slug as string | undefined) ?? undefined;
      return slug ? `/wiki/${slug}` : `/wiki`;
    }
    // Phase 5.7.2 sweep: Deliverable detail (Surface 14) exists now, link
    // directly. Previous "bold-only, link to parent project" was a pre-5.2.1
    // convention before the dedicated detail route landed.
    case "deliverable":
      return `/deliverables/${entityId}`;
    default:
      return null;
  }
}

function recordName(
  entityType: string,
  payload: Record<string, unknown> | null,
): string | null {
  if (!payload) return null;
  // The activity_log_writer pattern writes a NEW snapshot under various keys
  // depending on the trigger; try the common ones in priority order.
  // Phase 5.7.2 sweep: people rows store the human's name under `full_name`,
  // not `name`/`title`, so add it to the candidate list.
  const newSnapshot = payload.new as Record<string, unknown> | undefined;
  const candidates = [
    payload.name,
    payload.title,
    payload.full_name,
    newSnapshot?.name,
    newSnapshot?.title,
    newSnapshot?.full_name,
    payload.entity_name,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c;
  }
  return null;
}

function statusFromPayload(
  payload: Record<string, unknown> | null,
): { old_status: string | null; new_status: string | null } | null {
  if (!payload) return null;
  const direct = {
    old_status: typeof payload.old_status === "string" ? payload.old_status : null,
    new_status: typeof payload.new_status === "string" ? payload.new_status : null,
  };
  if (direct.new_status) return direct;
  const oldS = (payload.old as Record<string, unknown> | undefined)?.status;
  const newS = (payload.new as Record<string, unknown> | undefined)?.status;
  if (typeof newS === "string") {
    return {
      old_status: typeof oldS === "string" ? oldS : null,
      new_status: newS,
    };
  }
  return null;
}

function entityWord(entityType: string): string {
  switch (entityType) {
    case "project": return "project";
    case "task": return "task";
    case "venue": return "venue";
    case "vendor":
    case "organization": return "vendor";
    case "client": return "client";
    case "person": return "person";
    case "deliverable": return "deliverable";
    case "wiki_page": return "wiki page";
    case "outlook_entry": return "outlook entry";
    case "credential": return "credential";
    default: return entityType.replace(/_/g, " ");
  }
}

export function formatActivitySentence(row: ActivityRow): FormattedActivity {
  const actor = actorDisplay(row.actor);
  // Phase 5.7.2 sweep: normalize plural entity_type from activity_log_writer
  // (TG_TABLE_NAME) into the singular form every downstream switch expects.
  const entityType = singularizeEntityType(row.entity_type);
  const name = recordName(entityType, row.payload);
  const href = recordHrefFor(entityType, row.entity_id, row.payload);

  // Status change: prefer the "moved X to NEW_STATUS" template.
  const statusChange = statusFromPayload(row.payload);
  if (
    (row.action === "status_changed" ||
      (row.action === "updated" && statusChange?.new_status)) &&
    statusChange?.new_status
  ) {
    return {
      actor,
      recordName: name,
      recordHref: href,
      leadingText: " moved ",
      trailingText: ` to ${statusChange.new_status}`,
    };
  }

  if (row.action === "created") {
    return {
      actor,
      recordName: name,
      recordHref: href,
      leadingText: ` created ${entityWord(entityType)} `,
    };
  }

  if (row.action === "deleted") {
    return {
      actor,
      recordName: name,
      recordHref: null,
      recordIsBoldOnly: true,
      leadingText: ` deleted ${entityWord(entityType)} `,
    };
  }

  if (row.action === "assigned") {
    return {
      actor,
      recordName: name,
      recordHref: href,
      leadingText: " assigned you a task: ",
    };
  }

  // Phase 5.7.2 mention: payload carries `mentioned_user_full_name` and (after
  // the parent_title follow-up migration) `parent_title`. The record-link slot
  // surfaces the parent entity so the user can click through to the task /
  // deliverable / etc the mention lives on; the mentioned-user name renders
  // as plain bold leading text. When the payload predates the parent_title
  // backfill, fall back to "in this {entityWord}" with no record link.
  if (row.action === "mentioned") {
    const mentioned =
      typeof row.payload?.mentioned_user_full_name === "string"
        ? row.payload.mentioned_user_full_name
        : "someone";
    const parentTitle =
      typeof row.payload?.parent_title === "string" && row.payload.parent_title
        ? row.payload.parent_title
        : null;
    if (parentTitle) {
      return {
        actor,
        recordName: parentTitle,
        recordHref: href,
        leadingText: ` mentioned ${mentioned} in `,
      };
    }
    return {
      actor,
      recordName: mentioned,
      recordHref: "/users",
      leadingText: " mentioned ",
      trailingText: ` in this ${entityWord(entityType)}`,
    };
  }

  // Field-change payload: "changed FIELD on X from OLD to NEW".
  const field = typeof row.payload?.field === "string" ? row.payload.field : null;
  const oldVal =
    typeof row.payload?.old_value === "string" ? row.payload.old_value : null;
  const newVal =
    typeof row.payload?.new_value === "string" ? row.payload.new_value : null;
  if (field && newVal != null) {
    const fromTo = oldVal != null ? ` from ${oldVal} to ${newVal}` : ` to ${newVal}`;
    return {
      actor,
      recordName: name,
      recordHref: href,
      leadingText: ` changed ${field} on `,
      trailingText: fromTo,
    };
  }

  // Generic fallback for "updated" and anything else.
  return {
    actor,
    recordName: name,
    recordHref: href,
    leadingText: ` ${row.action.replace(/_/g, " ")} `,
  };
}

/**
 * Date bucketing for the day-grouped headers ("Today" / "Yesterday" /
 * "May 11"). Returns the label to use as the section header for the row's
 * created_at.
 */
export function dayBucketLabel(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  if (sameDay(d, now)) return "Today";
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (sameDay(d, y)) return "Yesterday";
  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

/**
 * Row-level timestamp grammar (spec § 5):
 *   Today    -> "X minutes/hours ago"
 *   Yesterday-> "5:02 PM" (time-only)
 *   Older    -> "N days ago"
 */
export function activityRowTimestamp(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  if (sameDay(d, now)) {
    const diffSec = Math.max(0, Math.floor((now.getTime() - d.getTime()) / 1000));
    if (diffSec < 60) return "Just now";
    const min = Math.floor(diffSec / 60);
    if (min < 60) return `${min} minute${min === 1 ? "" : "s"} ago`;
    const hr = Math.floor(min / 60);
    return `${hr} hour${hr === 1 ? "" : "s"} ago`;
  }
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (sameDay(d, y)) {
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  const day = Math.floor((now.getTime() - d.getTime()) / 86_400_000);
  return `${day} day${day === 1 ? "" : "s"} ago`;
}

/** Icon key for the actdot per entity_type (spec § 5 icon mapping). */
export type ActivityIconKey =
  | "project" | "task" | "deliverable" | "venue" | "vendor" | "client"
  | "person" | "wiki_page" | "credential" | "outlook_entry" | "notes_log"
  | "default";

export function iconKeyForEntity(entityType: string): ActivityIconKey {
  // Phase 5.7.2 sweep: normalize plural -> singular so plural rows from the
  // activity_log_writer (TG_TABLE_NAME) match the icon map.
  const t = singularizeEntityType(entityType);
  const known: ActivityIconKey[] = [
    "project", "task", "deliverable", "venue", "vendor", "client",
    "person", "wiki_page", "credential", "outlook_entry", "notes_log",
  ];
  return (known as string[]).includes(t)
    ? (t as ActivityIconKey)
    : "default";
}

// Re-export for callers needing a typed children type.
export type { ReactNode };
