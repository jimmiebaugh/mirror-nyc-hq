import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Per-user Calendar visibility persistence (Phase 5.3 spec § 6a).
 *
 * Stores 4 toggle states + the OFF set of project ids in a single
 * `saved_views` row per user (entity_type='calendar', name=
 * '__calendar_default'). One implicit row per user; no naming UI.
 *
 * `?source=projects` / `?source=tasks` first-visit defaults are applied
 * here: if no saved row exists yet, the initial INSERT writes Deliverables
 * / Holidays / Outlook-shared as false. If a saved row DOES exist, the
 * saved state wins (the source param is ignored).
 *
 * Writes are debounced (250ms) so a flurry of toggles produces one UPDATE.
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
  const rowIdRef = useRef<string | null>(null);
  const writeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data: userRes } = await supabase.auth.getUser();
      const userId = userRes.user?.id;
      if (!userId) {
        if (active) setLoading(false);
        return;
      }
      const { data: existing, error: selErr } = await supabase
        .from("saved_views")
        .select("id, filter_state")
        .eq("user_id", userId)
        .eq("entity_type", "calendar")
        .eq("name", "__calendar_default")
        .maybeSingle();
      if (selErr) console.warn("calendar visibility load failed", selErr);
      if (!active) return;
      if (existing) {
        const row = existing as unknown as SavedRow;
        rowIdRef.current = row.id;
        setState(parseFilterState(row.filter_state));
        setLoading(false);
        return;
      }
      // First visit: initial INSERT with source-aware defaults.
      const initial: CalendarVisibilityState =
        source === null ? ALL_ON : SOURCE_DEFAULT;
      const { data: inserted, error: insErr } = await supabase
        .from("saved_views")
        // saved_views.entity_type widened to include 'calendar' in the same
        // sub-phase migration; cast through never until types regenerate.
        .insert({
          user_id: userId,
          entity_type: "calendar",
          name: "__calendar_default",
          view_kind: "calendar",
          filter_state: initial as unknown as Record<string, unknown>,
          is_default: true,
        } as never)
        .select("id, filter_state")
        .single();
      if (!active) return;
      if (insErr) {
        console.warn("calendar visibility insert failed", insErr);
        setState(initial);
        setLoading(false);
        return;
      }
      const row = inserted as unknown as SavedRow;
      rowIdRef.current = row.id;
      setState(initial);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [source]);

  // Cleanup the debounce timer on unmount so a write doesn't fire on a
  // stale closure after the user navigates away mid-debounce.
  useEffect(() => {
    return () => {
      if (writeTimerRef.current) clearTimeout(writeTimerRef.current);
    };
  }, []);

  const scheduleWrite = useCallback((next: CalendarVisibilityState) => {
    if (writeTimerRef.current) clearTimeout(writeTimerRef.current);
    writeTimerRef.current = setTimeout(() => {
      const id = rowIdRef.current;
      if (!id) return;
      supabase
        .from("saved_views")
        .update({ filter_state: next as unknown as Record<string, unknown> })
        .eq("id", id)
        .then(({ error }) => {
          if (error) console.warn("calendar visibility update failed", error);
        });
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

  return {
    state,
    loading,
    setShowDeliverables,
    setShowHolidays,
    setShowSharedOutlook,
    toggleProject,
  };
}
