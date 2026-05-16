// Phase 5.5 shared helper: send a Slack DM via chat.postMessage.
//
// Uses the SLACK_BOT_TOKEN env var (set in Supabase functions secrets when
// the workspace is configured). Returns boolean (true = sent, false =
// missing token / Slack rejected). Never throws so callers can fan-out to
// many users without worrying about a single recipient breaking the loop.
//
// Channel = slack user id (the bot must have im:write to that user). The
// `users.slack_user_id` column on public.users is the lookup. Users with
// no slack_user_id are skipped at the dispatch layer, never reach this fn.

export async function sendSlackDm(
  slackUserId: string,
  text: string,
): Promise<boolean> {
  const token = Deno.env.get("SLACK_BOT_TOKEN");
  if (!token) {
    console.warn("[slackDm] SLACK_BOT_TOKEN not configured; skipping send");
    return false;
  }
  try {
    const res = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({ channel: slackUserId, text }),
    });
    const data = await res.json();
    if (!data.ok) {
      console.error(`[slackDm] Slack API error: ${data.error ?? "unknown"}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[slackDm] network error:", err);
    return false;
  }
}
