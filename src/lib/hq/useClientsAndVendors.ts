import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Phase 5.2 cleanup item A: composite lookup for the PeopleList
 * Organization filter.
 *
 * Merges `clients` + `vendors` into a single picker source so a chip like
 * `Organization is <Olipop>` can target a Client and `Organization is
 * <Testrite Visual>` can target a Vendor without two separate chip kinds.
 * The picked option's `id` flows through the FilterBar chip's `value`
 * field, then matches against the decorated row's `organization_id`
 * (which is `client_id ?? vendor_id` since the DB mutex CHECK guarantees
 * at most one is set).
 *
 * Sorted by name across both tables so the picker reads alphabetically;
 * a `sublabel` carries "Client" / "Vendor" for the option display so
 * picker readers can tell which side an entry comes from.
 */

export type ClientOrVendorOption = {
  id: string;
  name: string;
  sublabel: "Client" | "Vendor";
};

export function useClientsAndVendors() {
  const [options, setOptions] = useState<ClientOrVendorOption[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    (async () => {
      const [clientsRes, vendorsRes] = await Promise.all([
        supabase.from("clients").select("id, name").order("name", { ascending: true }),
        supabase.from("vendors").select("id, name").order("name", { ascending: true }),
      ]);
      if (!active) return;
      setLoading(false);
      if (clientsRes.error) console.warn("clients lookup load failed", clientsRes.error);
      if (vendorsRes.error) console.warn("vendors lookup load failed", vendorsRes.error);
      const merged: ClientOrVendorOption[] = [];
      for (const c of clientsRes.data ?? []) {
        merged.push({ id: c.id, name: c.name ?? "Untitled", sublabel: "Client" });
      }
      for (const v of vendorsRes.data ?? []) {
        merged.push({ id: v.id, name: v.name ?? "Untitled", sublabel: "Vendor" });
      }
      merged.sort((a, b) => a.name.localeCompare(b.name));
      setOptions(merged);
    })();
    return () => {
      active = false;
    };
  }, []);

  return { options, loading };
}
