import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { IconArrowLeft, IconCheck, IconSlack } from "@/components/icons/HQIcons";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { LoadError } from "@/components/ui/LoadError";

/**
 * Notification Preferences.
 * Wireframe binding: OUTPUTS/phase-5-hq-wireframe-v1-LOCKED.html lines 3282-3339.
 * Spec: OUTPUTS/phase-5-5-spec.md § 4.
 *
 * 7 trigger rows x 2 channels (In-App / Slack DM). No save button: each
 * toggle write upserts immediately. The auto-save pattern matches the
 * Wiki page / Settings Integrations card from 5.4. Slack status footer
 * reflects users.slack_user_id presence (added 5.4).
 */

type TriggerKey =
  | "deliverable_due_3d"
  | "task_assigned"
  | "task_due_today"
  | "task_blocked"
  | "project_status_changed"
  | "mention"
  | "event_date_today";

type ChannelKey = "in_app" | "slack_dm";

type TriggerRow = {
  key: TriggerKey;
  label: string;
  caption?: string;
  /** System defaults per spec § 2b. */
  defaults: { in_app: boolean; slack_dm: boolean };
};

const TRIGGER_ROWS: TriggerRow[] = [
  {
    key: "deliverable_due_3d",
    label: "Deliverable due in 3 days",
    caption: "On a Project you own",
    defaults: { in_app: true, slack_dm: false },
  },
  {
    key: "task_assigned",
    label: "Task assigned to me",
    defaults: { in_app: true, slack_dm: true },
  },
  {
    key: "task_due_today",
    label: "Task due today",
    caption: "Assigned to you",
    defaults: { in_app: true, slack_dm: true },
  },
  {
    key: "task_blocked",
    label: "A task I created becomes Blocked",
    defaults: { in_app: true, slack_dm: false },
  },
  {
    key: "project_status_changed",
    label: "Project Status changes",
    caption: "On a Project you own",
    defaults: { in_app: true, slack_dm: false },
  },
  {
    key: "mention",
    label: "Comment or @-mention",
    caption: "On a record you own or follow",
    defaults: { in_app: true, slack_dm: true },
  },
  {
    key: "event_date_today",
    label: "Install / Live / Removal happening today",
    caption: "On a Project you are assigned to",
    defaults: { in_app: true, slack_dm: false },
  },
];

type PrefRow = {
  trigger_key: string;
  in_app: boolean;
  slack_dm: boolean;
};

export default function NotificationPreferences() {
  const { user } = useAuth();
  const userId = user?.id;
  const [prefs, setPrefs] = useState<Record<string, PrefRow>>({});
  const [slackInfo, setSlackInfo] = useState<{
    handle: string | null;
    userId: string | null;
  }>({ handle: null, userId: null });
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    if (!userId) return;
    let active = true;
    setStatus("loading");
    Promise.all([
      supabase
        .from("user_notification_preferences")
        .select("trigger_key, in_app, slack_dm")
        .eq("user_id", userId),
      supabase
        .from("users")
        .select("slack_handle, slack_user_id")
        .eq("id", userId)
        .maybeSingle(),
    ])
      .then(([prefsRes, userRes]) => {
        if (!active) return;
        if (prefsRes.error) throw prefsRes.error;
        if (userRes.error) throw userRes.error;
        const map: Record<string, PrefRow> = {};
        for (const row of prefsRes.data ?? []) {
          map[row.trigger_key] = row;
        }
        setPrefs(map);
        setSlackInfo({
          handle: userRes.data?.slack_handle ?? null,
          userId: userRes.data?.slack_user_id ?? null,
        });
        setStatus("ready");
      })
      .catch((err) => {
        if (!active) return;
        console.error("[NotificationPreferences] load error:", err);
        setStatus("error");
      });
    return () => {
      active = false;
    };
  }, [userId]);

  const effective = useMemo(() => {
    const out: Record<string, { in_app: boolean; slack_dm: boolean }> = {};
    for (const row of TRIGGER_ROWS) {
      out[row.key] = prefs[row.key]
        ? { in_app: prefs[row.key].in_app, slack_dm: prefs[row.key].slack_dm }
        : { ...row.defaults };
    }
    return out;
  }, [prefs]);

  const onToggle = async (key: TriggerKey, channel: ChannelKey) => {
    if (!userId) return;
    const current = effective[key];
    const next = { ...current, [channel]: !current[channel] };
    // Optimistic update.
    setPrefs((prev) => ({
      ...prev,
      [key]: { trigger_key: key, in_app: next.in_app, slack_dm: next.slack_dm },
    }));
    const { error } = await supabase
      .from("user_notification_preferences")
      .upsert(
        {
          user_id: userId,
          trigger_key: key,
          in_app: next.in_app,
          slack_dm: next.slack_dm,
        },
        { onConflict: "user_id,trigger_key" },
      );
    if (error) {
      // Revert + error toast.
      setPrefs((prev) => ({
        ...prev,
        [key]: {
          trigger_key: key,
          in_app: current.in_app,
          slack_dm: current.slack_dm,
        },
      }));
      toast({
        title: "Save failed",
        description: error.message,
        variant: "destructive",
      });
      return;
    }
    toast({ title: "Preferences saved" });
  };

  return (
    <div style={{ maxWidth: 760, margin: "0 auto" }} className="space-y-6">
      <div className="space-y-3">
        <Link to="/home" className="crumb">
          <IconArrowLeft className="ic ic-sm" style={{ width: 12, height: 12 }} />{" "}
          Back to Home
        </Link>
        <div>
          <div className="eyebrow">Profile</div>
          <h1 className="h-page" style={{ marginTop: 4 }}>
            Notification Preferences
          </h1>
        </div>
      </div>

      {status === "loading" ? (
        <div className="card card-pad">
          <p className="cap" style={{ textAlign: "center", padding: 24 }}>
            Loading...
          </p>
        </div>
      ) : status === "error" ? (
        <LoadError
          title="Could not load preferences"
          description="Try refreshing the page."
          onRetry={() => window.location.reload()}
        />
      ) : (
        <>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Trigger</th>
                  <th className="c">In-App</th>
                  <th className="c">Slack DM</th>
                </tr>
              </thead>
              <tbody>
                {TRIGGER_ROWS.map((row) => {
                  const value = effective[row.key];
                  return (
                    <tr key={row.key}>
                      <td>
                        <div style={{ fontSize: 13 }}>{row.label}</div>
                        {row.caption ? (
                          <div className="cap">{row.caption}</div>
                        ) : null}
                      </td>
                      <td className="c">
                        <button
                          type="button"
                          className={`toggle ${value.in_app ? "toggle--on" : ""}`}
                          aria-pressed={value.in_app}
                          aria-label={`${row.label} in-app: ${value.in_app ? "on" : "off"}`}
                          onClick={() => onToggle(row.key, "in_app")}
                        />
                      </td>
                      <td className="c">
                        <button
                          type="button"
                          className={`toggle ${value.slack_dm ? "toggle--on" : ""}`}
                          aria-pressed={value.slack_dm}
                          aria-label={`${row.label} Slack DM: ${value.slack_dm ? "on" : "off"}`}
                          onClick={() => onToggle(row.key, "slack_dm")}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div
            className="row-c"
            style={{
              background: "hsl(var(--surface-alt))",
              border: "1px solid hsl(var(--border))",
              borderRadius: "var(--radius)",
              padding: "11px 14px",
            }}
          >
            {slackInfo.userId ? (
              <>
                <IconCheck
                  className="ic ic-sm"
                  style={{ width: 14, height: 14, color: "hsl(var(--success))" }}
                />
                <span className="cap">
                  Slack connected{slackInfo.handle ? ` · @${slackInfo.handle}` : ""} ·
                  email digest is a future phase
                </span>
              </>
            ) : (
              <>
                <IconSlack
                  className="ic ic-sm"
                  style={{ width: 14, height: 14, color: "hsl(var(--subtle-foreground))" }}
                />
                <span className="cap">
                  Slack not connected. Add your Slack User ID on the Team page to
                  enable Slack DM notifications.
                </span>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
