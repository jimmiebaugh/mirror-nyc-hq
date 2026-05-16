import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Phase 5.3: clients-only lookup hook. Sibling of useClientsAndVendors.
 *
 * Outlook entries link to clients only (pre-Project; vendors don't make
 * sense here). The Outlook edit form's Client picker reads from this hook;
 * the picker stores the client id and resolves it back to name on display.
 */

export type ClientOption = { id: string; name: string };

export function useClients() {
  const [options, setOptions] = useState<ClientOption[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    (async () => {
      const { data, error } = await supabase
        .from("clients")
        .select("id, name")
        .order("name", { ascending: true });
      if (!active) return;
      setLoading(false);
      if (error) {
        console.warn("clients lookup load failed", error);
        setOptions([]);
        return;
      }
      setOptions(
        ((data ?? []) as { id: string; name: string | null }[]).map((c) => ({
          id: c.id,
          name: c.name ?? "Untitled",
        })),
      );
    })();
    return () => {
      active = false;
    };
  }, []);

  return { options, loading };
}
