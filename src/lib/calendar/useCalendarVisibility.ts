import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Per-user Calendar visibility persistence (Phase 5.3 spec § 6a; extended
 * Phase 5.6.5 with global-default fallback).
 *
 * Stores 4 toggle states + the OFF set of project ids in a `saved_views`
 * row (entity_type='calendar', name='__calendar_default'). Resolution
 * order on mount:
 *   1. Per-user `scope='user'` row -> use it; subsequent toggles UPDATE it.
 *   2. Otherwise: global `scope='global', is_default=true` row published
 *      by an owner -> use its state; no per-user row exists yet so first
 *      toggle INSERTs one.
 *   3. Otherwise: first-visit fallback. Source-aware defaults (per the
 *      Phase 5.3 spec); INSERTs a per-user row eagerly so subsequent
 *      toggles can UPDATE it.
 *
 * `?source=projects` / `?source=tasks` first-visit defaults still apply
 * only in branch 3 (no row exists at all and no global override).
 *
 * Writes are debounced (250ms) so a flurry of toggles produces one write.
 */

export type CalendarVisibilityState = {
  showDeliverables: boolean;
  showHolidays: boolean;
  showSharedOutlook: boolean;
  /** OFF set: projects whose toggle is currently off. */
  hiddenProjectIds: string[];
};

export type CalendarSource = "projects" | "tasks" | null;

const ALL_ON: CalendarVisibilityState = {
  showDeliverables: true,
  showHolidays: true,
  showSharedOutlook: true,
  hiddenProjectIds: [],
};

const SOURCE_DEFAULT: CalendarVisibilityState = {
  showDeliverables: false,
  showHolidays: false,
  showSharedOutlook: false,
  hiddenProjectIds: [],
};

type SavedRow = {
  id: string;
  filter_state: Record<string, unknown>;
};

function parseFilterState(raw: unknown): CalendarVisibilityState {
  const fs = (raw ?? {}) as Record<string, unknown>;
  return {
    showDeliverables: typeof fs.showDeliverables === "boolean" ? fs.showDeliverables : true,
    showHolidays: typeof fs.showHolidays === "boolean" ? fs.showHolidays : true,
    showSharedOutlook: typeof fs.showSharedOutlook === "boolean" ? fs.showSharedOutlook : true,
    hiddenProjectIds: Array.isArray(fs.hiddenProjectIds)
      ? (fs.hiddenProjectIds as unknown[]).filter((x): x is string => typeof x === "string")
      : [],
  };
}

export function useCalendarVisibility(source: CalendarSource) {
  const [state, setState] = useState<CalendarVisibilityState>(ALL_ON);
  const [loading, setLoading] = useState(true);
  const [hasPerUserRow, setHasPerUserRow] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const rowIdRef = useRef<string | null>(null);
  const userIdRef = useRef<string | null>(null);
  const writeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    (async () => {
      const { data: userRes } = await supabase.auth.getUser();
      const userId = userRes.user?.id;
      userIdRef.current = userId ?? null;
      if (!userId) {
        if (active) {
          rowIdRef.current = null;
          setHasPerUserRow(false);
          setLoading(false);
        }
        return;
      }

      // 1) Per-user row wins.
      const userRowRes = await supabase
        .from("saved_views")
        .select("id, filter_state")
        .eq("user_id", userId)
        .eq("entity_type", "calendar")
        .eq("name", "__calendar_default")
        .eq("scope", "user")
        .maybeSingle();
      if (!active) return;
      if (userRowRes.data) {
        const row = userRowRes.data as unknown as SavedRow;
        rowIdRef.current = row.id;
        setHasPerUserRow(true);
        setState(parseFilterState(row.filter_state));
        setLoading(false);
        return;
      }

      // 2) Global fallback. Read-only here; we don't bind rowIdRef to a
      // global row because the user can't write to it. Subsequent
      // toggles will INSERT a per-user row via `scheduleWrite`.
      const globalRowRes = await supabase
        .from("saved_views")
        .select("id, filter_state")
        .eq("entity_type", "calendar")
        .eq("name", "__calendar_default")
        .eq("scope", "global")
        .eq("is_default", true)
        .maybeSingle();
      if (!active) return;
      if (globalRowRes.data) {
        const row = globalRowRes.data as unknown as SavedRow;
        rowIdRef.current = null;
        setHasPerUserRow(false);
        setState(parseFilterState(row.filter_state));
        setLoading(false);
        return;
      }

      // 3) First-visit fallback: source-aware INSERT of a per-user row.
      const initial: CalendarVisibilityState =
        source === null ? ALL_ON : SOURCE_DEFAULT;
      const { data: inserted, error: insErr } = await supabase
        .from("saved_views")
        .insert({
          user_id: userId,
          entity_type: "calendar",
          name: "__calendar_default",
          view_kind: "calendar",
          filter_state: initial as unknown as Record<string, unknown>,
          is_default: true,
          scope: "user",
        } as never)
        .select("id, filter_state")
        .single();
      if (!active) return;
      if (insErr) {
        console.warn("calendar visibility insert failed", insErr);
        rowIdRef.current = null;
        setHasPerUserRow(false);
        setState(initial);
        setLoading(false);
        return;
      }
      const row = inserted as unknown as SavedRow;
      rowIdRef.current = row.id;
      setHasPerUserRow(true);
      setState(initial);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [source, refreshTick]);

  // Cleanup the debounce timer on unmount so a write doesn't fire on a
  // stale closure after the user navigates away mid-debounce.
  useEffect(() => {
    return () => {
      if (writeTimerRef.current) clearTimeout(writeTimerRef.current);
    };
  }, []);

  const scheduleWrite = useCallback((next: CalendarVisibilityState) => {
    if (writeTimerRef.current) clearTimeout(writeTimerRef.current);
    writeTimerRef.current = setTimeout(async () => {
      const id = rowIdRef.current;
      const userId = userIdRef.current;
      if (id) {
        const { error } = await supabase
          .from("saved_views")
          .update({ filter_state: next as unknown as Record<string, unknown> } as never)
          .eq("id", id);
        if (error) console.warn("calendar visibility update failed", error);
        return;
      }
      // No per-user row yet (user was reading a global default).
      // Insert one now using the current in-memory state.
      if (!userId) return;
      const { data: inserted, error } = await supabase
        .from("saved_views")
        .insert({
          user_id: userId,
          entity_type: "calendar",
          name: "__calendar_default",
          view_kind: "calendar",
          filter_state: next as unknown as Record<string, unknown>,
          is_default: true,
          scope: "user",
        } as never)
        .select("id")
        .single();
      if (error || !inserted) {
        console.warn("calendar visibility insert-on-toggle failed", error);
        return;
      }
      rowIdRef.current = (inserted as { id: string }).id;
      setHasPerUserRow(true);
    }, 250);
  }, []);

  const setShowDeliverables = useCallback(
    (v: boolean) => {
      setState((s) => {
        const next = { ...s, showDeliverables: v };
        scheduleWrite(next);
        return next;
      });
    },
    [scheduleWrite],
  );

  const setShowHolidays = useCallback(
    (v: boolean) => {
      setState((s) => {
        const next = { ...s, showHolidays: v };
        scheduleWrite(next);
        return next;
      });
    },
    [scheduleWrite],
  );

  const setShowSharedOutlook = useCallback(
    (v: boolean) => {
      setState((s) => {
        const next = { ...s, showSharedOutlook: v };
        scheduleWrite(next);
        return next;
      });
    },
    [scheduleWrite],
  );

  const toggleProject = useCallback(
    (id: string, visible: boolean) => {
      setState((s) => {
        const set = new Set(s.hiddenProjectIds);
        if (visible) set.delete(id);
        else set.add(id);
        const next = { ...s, hiddenProjectIds: Array.from(set) };
        scheduleWrite(next);
        return next;
      });
    },
    [scheduleWrite],
  );

  const refresh = useCallback(() => {
    setRefreshTick((t) => t + 1);
  }, []);

  return {
    state,
    loading,
    hasPerUserRow,
    setShowDeliverables,
    setShowHolidays,
    setShowSharedOutlook,
    toggleProject,
    refresh,
  };
}
