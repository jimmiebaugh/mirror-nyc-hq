import { useNavigate } from "react-router-dom";
import { IconLock } from "@/components/icons/HQIcons";

/**
 * Phase 5.5 shared permission-denied component (spec § 7).
 *
 * Wireframe binding: OUTPUTS/phase-5-hq-wireframe-v1-LOCKED.html lines 3491-3523
 * (Surface 23 permission-denied screen). Renders a centered card with the
 * coral lock badge, the page-specific title, a body explaining the user's
 * tier, and a "Back to Home" button. Replaces the old AdminRoute redirect
 * pattern so the user sees a clear "no access" message instead of being
 * bounced silently back to /home.
 */

export function PermissionDenied({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  const navigate = useNavigate();
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "60vh",
      }}
    >
      <div
        className="card card-pad"
        style={{ width: 460, textAlign: "center" }}
      >
        <div
          className="actdot"
          style={{
            width: 44,
            height: 44,
            margin: "0 auto 16px",
            color: "hsl(var(--primary))",
            borderColor: "rgba(190,78,68,.4)",
            background: "rgba(190,78,68,.1)",
          }}
        >
          <IconLock style={{ width: 20, height: 20 }} />
        </div>
        <h3 className="h-card">{title}</h3>
        <p className="desc" style={{ marginTop: 10 }}>
          {description} If you need access, ask an admin.
        </p>
        <button
          type="button"
          className="btn btn-secondary"
          style={{ marginTop: 18 }}
          onClick={() => navigate("/home")}
        >
          Back to Home
        </button>
      </div>
    </div>
  );
}
