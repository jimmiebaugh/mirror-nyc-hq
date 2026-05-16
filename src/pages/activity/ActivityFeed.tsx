import { Fragment, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  FilterBar,
  emptyFilterState,
  type FilterFieldDef,
  type FilterState,
} from "@/components/data/FilterBar";
import { applyFilters } from "@/lib/hq/filterStateApply";
import {
  fetchActivityPage,
  ACTIVITY_PAGE_SIZE,
  type ActivityRow,
} from "@/lib/activity/queries";
import {
  activityRowTimestamp,
  dayBucketLabel,
  formatActivitySentence,
  iconKeyForEntity,
} from "@/lib/activity/formatSentence";
import {
  IconActivity,
  IconCalendar,
  IconClients,
  IconComment,
  IconDeliverables,
  IconLock,
  IconOrgs,
  IconOutlook,
  IconPeople,
  IconProjects,
  IconTasks,
  IconVenues,
  IconWiki,
} from "@/components/icons/HQIcons";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadError } from "@/components/ui/LoadError";
import { supabase } from "@/integrations/supabase/client";

/**
 * Activity Feed.
 * Wireframe binding: OUTPUTS/phase-5-hq-wireframe-v1-LOCKED.html lines 3345-3404.
 * Spec: OUTPUTS/phase-5-5-spec.md § 5.
 */

const DATE_RANGE_OPTIONS = [
  "Today",
  "Yesterday",
  "Last 7 days",
  "Last 30 days",
  "This month",
];

function ActivityIcon({ entityType }: { entityType: string }) {
  const key = iconKeyForEntity(entityType);
  const style = { width: 14, height: 14 } as const;
  switch (key) {
    case "project":      return <IconProjects style={style} />;
    case "task":         return <IconTasks style={style} />;
    case "deliverable":  return <IconDeliverables style={style} />;
    case "venue":        return <IconVenues style={style} />;
    case "vendor":       return <IconOrgs style={style} />;
    case "client":       return <IconClients style={style} />;
    case "person":       return <IconPeople style={style} />;
    case "wiki_page":    return <IconWiki style={style} />;
    case "credential":   return <IconLock style={style} />;
    case "outlook_entry":return <IconOutlook style={style} />;
    case "notes_log":    return <IconComment style={style} />;
    default:             return <IconActivity style={style} />;
  }
}

const ENTITY_TYPE_OPTIONS = [
  { label: "Projects", value: "project" },
  { label: "Tasks", value: "task" },
  { label: "Deliverables", value: "deliverable" },
  { label: "Venues", value: "venue" },
  { label: "Vendors", value: "vendor" },
  { label: "Clients", value: "client" },
  { label: "People", value: "person" },
  { label: "Wiki", value: "wiki_page" },
  { label: "Outlook", value: "outlook_entry" },
];

/**
 * Date-range chip predicate. Returns the earliest timestamp that should be
 * accepted given the chip's value; rows with created_at < min are filtered.
 */
function dateRangeMin(label: string, now: Date = new Date()): Date | null {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  switch (label) {
    case "Today":
      return start;
    case "Yesterday": {
      const d = new Date(start);
      d.setDate(d.getDate() - 1);
      return d;
    }
    case "Last 7 days": {
      const d = new Date(start);
      d.setDate(d.getDate() - 7);
      return d;
    }
    case "Last 30 days": {
      const d = new Date(start);
      d.setDate(d.getDate() - 30);
      return d;
    }
    case "This month": {
      const d = new Date(now.getFullYear(), now.getMonth(), 1);
      return d;
    }
    default:
      return null;
  }
}

function dateRangeMax(label: string, now: Date = new Date()): Date | null {
  if (label === "Yesterday") {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return d; // strictly less than start of today
  }
  return null;
}

export default function ActivityFeed() {
  const [pages, setPages] = useState<ActivityRow[][]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [loadingMore, setLoadingMore] = useState(false);
  const [filterState, setFilterState] = useState<FilterState>(emptyFilterState());
  const [userOptions, setUserOptions] = useState<{ id: string; name: string }[]>(
    [],
  );

  // First-page load.
  useEffect(() => {
    let active = true;
    setStatus("loading");
    fetchActivityPage()
      .then((res) => {
        if (!active) return;
        setPages([res.rows]);
        setHasMore(res.hasMore);
        setStatus("ready");
      })
      .catch((err) => {
        if (!active) return;
        console.error("[ActivityFeed] load error:", err);
        setStatus("error");
      });
    return () => {
      active = false;
    };
  }, []);

  // Populate the actor lookup options once. Falls back to an empty list on
  // RLS denial so the filter bar still works (chip just won't match anything).
  useEffect(() => {
    supabase
      .from("users")
      .select("id, full_name, email")
      .eq("active", true)
      .order("full_name", { ascending: true })
      .then(({ data, error }) => {
        if (error) {
          console.error("[ActivityFeed] user list error:", error);
          return;
        }
        setUserOptions(
          (data ?? []).map((u) => ({
            id: u.id,
            name: u.full_name?.trim() || u.email || "Unknown",
          })),
        );
      });
  }, []);

  const fields: FilterFieldDef[] = useMemo(
    () => [
      {
        key: "entity_type",
        label: "Record type",
        type: "enum",
        options: ENTITY_TYPE_OPTIONS.map((o) => o.label),
      },
      {
        key: "actor_id",
        label: "Person",
        type: "lookup",
        lookupOptions: userOptions,
      },
      {
        key: "date_range",
        label: "Date",
        type: "enum",
        options: DATE_RANGE_OPTIONS,
      },
    ],
    [userOptions],
  );

  // Apply client-side filters. Date_range is pre-filtered against the row's
  // created_at because applyFilters' `is` op compares scalars, not windows;
  // entity_type + actor_id then flow through applyFilters normally.
  const flatRows = useMemo(() => pages.flat(), [pages]);
  const filteredRows = useMemo(() => {
    // Step 1: pre-filter by every `date_range` chip (AND across multiple).
    const dateChips = filterState.chips.filter((c) => c.field === "date_range");
    const dateFiltered = flatRows.filter((row) => {
      if (dateChips.length === 0) return true;
      const d = new Date(row.created_at);
      return dateChips.every((chip) => {
        const label = Array.isArray(chip.value) ? chip.value[0] : chip.value;
        const min = dateRangeMin(label);
        const max = dateRangeMax(label);
        return (!min || d >= min) && (!max || d < max);
      });
    });

    // Step 2: apply remaining chips via applyFilters.
    const nonDateState = {
      ...filterState,
      chips: filterState.chips.filter((c) => c.field !== "date_range"),
    };
    return applyFilters(dateFiltered, nonDateState, (row, key) => {
      switch (key) {
        case "entity_type": {
          const label = ENTITY_TYPE_OPTIONS.find(
            (o) => o.value === row.entity_type,
          );
          return label?.label ?? null;
        }
        case "actor_id":
          return row.actor?.id ?? null;
        default:
          return null;
      }
    });
  }, [flatRows, filterState]);

  // Day-bucket the filtered rows for the section headers.
  const grouped = useMemo(() => {
    const acc: { label: string; rows: ActivityRow[] }[] = [];
    let currentLabel: string | null = null;
    for (const row of filteredRows) {
      const label = dayBucketLabel(row.created_at);
      if (label !== currentLabel) {
        acc.push({ label, rows: [row] });
        currentLabel = label;
      } else {
        acc[acc.length - 1].rows.push(row);
      }
    }
    return acc;
  }, [filteredRows]);

  const handleLoadMore = async () => {
    const lastPage = pages[pages.length - 1] ?? [];
    const last = lastPage[lastPage.length - 1];
    if (!last) return;
    setLoadingMore(true);
    try {
      const res = await fetchActivityPage({ cursor: last.created_at });
      setPages((prev) => [...prev, res.rows]);
      setHasMore(res.hasMore);
    } catch (err) {
      console.error("[ActivityFeed] load-more failed:", err);
    } finally {
      setLoadingMore(false);
    }
  };

  const handleRetry = () => {
    setStatus("loading");
    fetchActivityPage()
      .then((res) => {
        setPages([res.rows]);
        setHasMore(res.hasMore);
        setStatus("ready");
      })
      .catch((err) => {
        console.error("[ActivityFeed] retry error:", err);
        setStatus("error");
      });
  };

  return (
    <div style={{ maxWidth: 880, margin: "0 auto" }} className="space-y-6">
      <div className="pagehead">
        <h1 className="h-page">Activity Feed</h1>
      </div>

      <FilterBar state={filterState} onChange={setFilterState} fields={fields} />

      {status === "loading" ? (
        <div className="card card-pad">
          <EmptyState icon={IconActivity}>Loading...</EmptyState>
        </div>
      ) : status === "error" ? (
        <div className="card card-pad">
          <LoadError
            title="Could not load the activity feed"
            description="The request timed out. Your connection looks fine, this is on our end."
            onRetry={handleRetry}
          />
        </div>
      ) : grouped.length === 0 ? (
        <div className="card card-pad">
          <EmptyState icon={IconActivity}>
            No activity yet. Changes to projects, tasks, and deliverables will appear here.
          </EmptyState>
        </div>
      ) : (
        <div className="card card-pad">
          {grouped.map((group, gi) => (
            <Fragment key={`${group.label}-${gi}`}>
              <div
                className="cap"
                style={{
                  marginBottom: gi === 0 ? 6 : 6,
                  marginTop: gi === 0 ? 0 : 14,
                }}
              >
                {group.label}
              </div>
              {group.rows.map((row, ri) => {
                const f = formatActivitySentence(row);
                const isLastOverall =
                  gi === grouped.length - 1 && ri === group.rows.length - 1;
                return (
                  <div
                    key={row.id}
                    className="activity-row"
                    style={
                      isLastOverall && !hasMore
                        ? { borderBottom: "none" }
                        : undefined
                    }
                  >
                    <span className="actdot">
                      <ActivityIcon entityType={row.entity_type} />
                    </span>
                    <div>
                      <div className="txt">
                        {f.actor.id ? (
                          <Link to={`/users/${f.actor.id}`} className="who">
                            {f.actor.name}
                          </Link>
                        ) : (
                          <span className="who">{f.actor.name}</span>
                        )}
                        {f.leadingText}
                        {f.recordName ? (
                          f.recordIsBoldOnly ? (
                            <span className="dlv">{f.recordName}</span>
                          ) : f.recordHref ? (
                            <Link to={f.recordHref}>
                              <b>{f.recordName}</b>
                            </Link>
                          ) : (
                            <b>{f.recordName}</b>
                          )
                        ) : null}
                        {f.trailingText}
                      </div>
                      <div className="ts">{activityRowTimestamp(row.created_at)}</div>
                    </div>
                  </div>
                );
              })}
            </Fragment>
          ))}
        </div>
      )}

      {status === "ready" && hasMore && grouped.length > 0 ? (
        <div className="row" style={{ justifyContent: "center" }}>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={loadingMore}
            onClick={handleLoadMore}
          >
            {loadingMore ? "Loading..." : "Load more"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
