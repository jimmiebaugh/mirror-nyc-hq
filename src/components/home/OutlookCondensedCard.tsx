import { Link } from "react-router-dom";
import { IconExt } from "@/components/icons/HQIcons";

/**
 * Phase 5.1 Outlook condensed card placeholder (spec § 7c).
 *
 * The `outlook_entries` table lands in 5.3. The card honors the layout slot
 * with a static "lands in Phase 5.3" placeholder; clicking through to
 * /outlook still routes (to a stub) so the affordance is real. No fake data.
 */
export function OutlookCondensedCard() {
  const currentMonth = new Date().getMonth(); // 0-based
  const MONTH_LABELS = [
    "JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC",
  ];

  return (
    <div className="hq-card">
      <div className="hq-card-headbar">
        <span className="h-card">Outlook · {new Date().getFullYear()}</span>
        <Link to="/outlook" className="hq-tlink">
          Expand <IconExt className="h-[14px] w-[14px]" />
        </Link>
      </div>
      <div className="hq-card-pad">
        <div className="grid grid-cols-4 gap-2">
          {MONTH_LABELS.map((label, i) => (
            <div
              key={label}
              className={`hq-ol-cell ${i === currentMonth ? "hq-ol-cell--current" : ""}`}
            >
              <div className="hq-ol-cell-mn">{label}</div>
              <div className="hq-ol-entry">
                <div className="hq-ol-entry-nm text-[hsl(var(--subtle-foreground))]">
                  Outlook lands in Phase 5.3
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}