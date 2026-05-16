import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Mirror NYC Holidays.
 *
 * Phase 5.4 moved the hardcoded MIRROR_HOLIDAYS array into the
 * `mirror_holidays` table so admins can CRUD via the Settings page.
 * The seed values in migration 20260516160000_phase_5_4_wiki_team_settings
 * match the previously-hardcoded constant exactly so behavior on deploy
 * is unchanged.
 *
 * The Calendar page consumes this hook; the row shape is normalized to
 * the same `{ dateIso, label }` pair the constant used so the rest of
 * the page didn't need to know.
 */

export type MirrorHoliday = {
  /** YYYY-MM-DD. */
  dateIso: string;
  label: string;
};

export function useMirrorHolidays(): {
  holidays: MirrorHoliday[];
  loading: boolean;
} {
  const [holidays, setHolidays] = useState<MirrorHoliday[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    (async () => {
      const { data, error } = await supabase
        .from("mirror_holidays")
        .select("name, date")
        .order("date", { ascending: true });
      if (!active) return;
      if (error) {
        console.warn("useMirrorHolidays load failed", error);
        setHolidays([]);
      } else {
        setHolidays(
          ((data ?? []) as { name: string; date: string }[]).map((r) => ({
            dateIso: r.date,
            label: r.name,
          })),
        );
      }
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  return { holidays, loading };
}
