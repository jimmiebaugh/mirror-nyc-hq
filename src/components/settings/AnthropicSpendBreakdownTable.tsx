import { Fragment, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

type BreakdownRow = {
  app: "talent_scout" | "venue_scout" | "hq";
  fn_name: string;
  calls: number;
  total_cost_usd: number;
  avg_cost_usd: number;
};

const APP_LABEL: Record<BreakdownRow["app"], string> = {
  talent_scout: "Talent Scout",
  venue_scout: "Venue Scout",
  hq: "HQ Core",
};

const APP_ORDER: BreakdownRow["app"][] = ["hq", "talent_scout", "venue_scout"];

type Props = {
  appFilter?: BreakdownRow["app"];
  window?: "month" | "year";
};

/**
 * Per-tool Anthropic spend breakdown for the selected window.
 *
 * Reads `public.anthropic_spend_breakdown({ window_kind })` (SECURITY
 * DEFINER, admin-gated inside the function body). RLS on
 * `anthropic_call_log` is admin-only; non-admins hitting the RPC see the
 * `admin only` exception, surface a toast, and render the empty state.
 *
 * Two render modes (Phase 5.15.1):
 *   - `appFilter` set (TS + VS Settings): flat per-fn table for that one
 *     app. Drops the App label column; the page context supplies it.
 *   - `appFilter` omitted (HQ Admin Settings): grouped table with HQ /
 *     TS / VS subheaders in fixed order, each with inline subtotal.
 *     Empty groups render a "No calls {window}" stub under the
 *     subheader so the three sections are always visible.
 *
 * Window prop (Phase 5.15.3): `'month'` (default) shows current calendar
 * month rows; `'year'` shows year-to-date rows. The RPC handles the
 * range arithmetic via `window_kind`; the component only labels copy.
 */
export function AnthropicSpendBreakdownTable({
  appFilter,
  window = "month",
}: Props = {}) {
  const [rows, setRows] = useState<BreakdownRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase.rpc(
        "anthropic_spend_breakdown",
        { window_kind: window },
      );
      if (!active) return;
      if (error) {
        toast({
          title: "Failed to load breakdown",
          description: error.message,
          variant: "destructive",
        });
        setLoading(false);
        return;
      }
      setRows((data ?? []) as BreakdownRow[]);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [window]);

  const windowSuffix = window === "year" ? "this year" : "this month";

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading breakdown…</p>;
  }

  if (appFilter) {
    const filtered = rows
      .filter((r) => r.app === appFilter)
      .sort((a, b) => Number(b.total_cost_usd) - Number(a.total_cost_usd));
    if (filtered.length === 0) {
      return (
        <p className="text-xs text-muted-foreground">
          No {APP_LABEL[appFilter]} calls recorded {windowSuffix} yet.
        </p>
      );
    }
    return (
      <div className="tbl-list">
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th className="l">Function</th>
                <th className="r">Calls</th>
                <th className="r">Total Spend</th>
                <th className="r">Avg / Call</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={`${r.app}-${r.fn_name}`}>
                  <td className="mono l">{r.fn_name}</td>
                  <td className="r">{Number(r.calls).toLocaleString()}</td>
                  <td className="r">${Number(r.total_cost_usd).toFixed(2)}</td>
                  <td className="r">${Number(r.avg_cost_usd).toFixed(4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No Anthropic calls recorded {windowSuffix} yet.
      </p>
    );
  }

  const byApp = APP_ORDER.map((app) => {
    const appRows = rows
      .filter((r) => r.app === app)
      .sort((a, b) => Number(b.total_cost_usd) - Number(a.total_cost_usd));
    const callsTotal = appRows.reduce((acc, r) => acc + Number(r.calls), 0);
    const spendTotal = appRows.reduce(
      (acc, r) => acc + Number(r.total_cost_usd),
      0,
    );
    return { app, rows: appRows, callsTotal, spendTotal };
  });

  return (
    <div className="tbl-list">
      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th className="l">Function</th>
              <th className="r">Calls</th>
              <th className="r">Total Spend</th>
              <th className="r">Avg / Call</th>
            </tr>
          </thead>
          <tbody>
            {byApp.map((group) => (
              <Fragment key={group.app}>
                <tr className="tbl-divider">
                  <td colSpan={4}>
                    {APP_LABEL[group.app]}
                    <span className="ml-2 normal-case">
                      · {group.callsTotal.toLocaleString()} call
                      {group.callsTotal === 1 ? "" : "s"} · $
                      {group.spendTotal.toFixed(2)} total
                    </span>
                  </td>
                </tr>
                {group.rows.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="muted">
                      No calls {windowSuffix}
                    </td>
                  </tr>
                ) : (
                  group.rows.map((r) => (
                    <tr key={`${r.app}-${r.fn_name}`}>
                      <td className="mono l">{r.fn_name}</td>
                      <td className="r">{Number(r.calls).toLocaleString()}</td>
                      <td className="r">
                        ${Number(r.total_cost_usd).toFixed(2)}
                      </td>
                      <td className="r">
                        ${Number(r.avg_cost_usd).toFixed(4)}
                      </td>
                    </tr>
                  ))
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
