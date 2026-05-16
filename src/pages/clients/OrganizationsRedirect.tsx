import { useEffect, useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

/**
 * Backward-compat redirect for the shipped `/organizations/:id` URLs.
 *
 * Phase 5.2.3 split the unified `organizations` table into `clients`
 * + `vendors`. Old bookmarks land here; we look up which table the
 * id is in and 301-replace to the right surface. Lives in
 * src/pages/clients/ rather than its own folder because the
 * resolution favors clients (alphabetical neighbor); arbitrary
 * organizational choice, no behavioral impact.
 *
 * Drop this redirect in a future polish pass once Mirror's bookmarks
 * have updated.
 */
export default function OrganizationsRedirect({
  editMode = false,
}: {
  editMode?: boolean;
}) {
  const { id } = useParams<{ id: string }>();
  const [target, setTarget] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!id) {
      setNotFound(true);
      return;
    }
    let active = true;
    (async () => {
      const [clientRes, vendorRes] = await Promise.all([
        supabase.from("clients").select("id").eq("id", id).maybeSingle(),
        supabase.from("vendors").select("id").eq("id", id).maybeSingle(),
      ]);
      if (!active) return;
      const suffix = editMode ? "/edit" : "";
      if (clientRes.data) {
        setTarget(`/clients/${id}${suffix}`);
      } else if (vendorRes.data) {
        setTarget(`/vendors/${id}${suffix}`);
      } else {
        // Old client UUID that got swept in 5.2.3.B's DELETE may still
        // exist in clients (UUID preserved in 5.2.3.A); the .maybeSingle
        // above resolves that. Genuine 404 falls through to /vendors.
        setNotFound(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [id, editMode]);

  if (notFound) {
    return <Navigate to="/vendors" replace />;
  }
  if (!target) {
    return (
      <div className="empty">
        <p>Resolving...</p>
      </div>
    );
  }
  return <Navigate to={target} replace />;
}
