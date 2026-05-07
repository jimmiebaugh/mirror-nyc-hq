# Drop-in prompt for the next Claude Code session

Paste everything below the line into a fresh chat to bring it up to speed.

---

You're picking up work on **Mirror NYC HQ**, the internal web app I'm building (I'm Jimmie Baugh, Senior Producer at Mirror NYC, an experiential events agency in NYC). I'm not a developer. You do the heavy backend lifting; I use Lovable for net-new UI scaffolding only.

## How I want you to talk to me

- Casual, direct, friend-who-knows-this-stuff tone.
- **No em dashes anywhere.**
- No filler affirmations ("Great question!", "Absolutely!", etc.).
- Concise by default, deeper when the task calls for it.
- Recommend, don't just present options. State the tradeoff plainly.
- Reference only the latest version of anything. If we iterated, the old version is gone.
- Don't fill in gaps. If something's unclear, ask me. Don't infer.

Full conventions live in `docs/conventions.md`.

## Stack at a glance

React + Vite + TS + Tailwind + shadcn/ui frontend. Supabase Postgres + Edge Functions + Storage + Realtime backend. Netlify hosting. Anthropic API + Google Workspace via service account. Production at `hq.mirrornyc.com`. Supabase project ref `amipjjmphblfxpghjnel`.

Monolith: one repo, one app, one DB. `/talent-scout` and `/venue-scout` are routes inside HQ.

## Where we are

Active phase is **3.6 (Final Review + Packet generation)** on branch `phase-3-6-final-review-packet`, latest commit `d6a53d6`. Not merged to main yet. Production is still on pre-3.6 main.

For full state, read these three files in the project root before doing anything else:

1. **`PROJECT_STATUS.md`** — current state, what's working, what's in progress, what's drifted.
2. **`DECISIONS.md`** — every meaningful technical/design decision in this phase, including what we explicitly ruled out (don't re-litigate those).
3. **`NEXT_STEPS.md`** — ordered next actions, files involved, gotchas already discovered.

Also useful:
- `CLAUDE.md` (project root) — the full project bible.
- `CHECKPOINT.md` — living state doc. Note: as of the last session it was stale, predating Phase 3.6.1 → 3.6.11. Updating it is on the next-steps list.
- `docs/` — `architecture.md`, `schema.md`, `auth-model.md`, `edge-functions.md`, `cron-jobs.md`, `conventions.md`, `decisions.md`, `operations.md`, `roadmap.md`, `talent-scout-port-plan.md`.

## Things to know that bit us in the last session

- **Don't pipe `supabase gen types --linked` directly into `src/integrations/supabase/types.ts`.** Shell `>` truncates first; if the gen fails the file is empty. Use the `/tmp` + `test -s` + `mv` pattern instead.
- **Local dev runs at `http://127.0.0.1:8080/`, not `localhost:8080`.** Vite binds IPv6; Chrome misroutes localhost to a 404.
- **Postgrest errors aren't `Error` instances.** Use `fmtErr` to surface real messages instead of `[object Object]`.
- **Don't reintroduce CloudConvert.** PDF generation is pure pdf-lib in `supabase/functions/_shared/packetRender.ts`. Don't reintroduce MIME-attaching the packet either; email body carries a signed URL.
- **Frontend can't import from `supabase/functions/_shared`.** `src/lib/talent-scout/defaultEvalPrompt.ts` is a manual mirror of the server prompt; keep both in sync.

## Start here

Read `PROJECT_STATUS.md`, `DECISIONS.md`, and `NEXT_STEPS.md` in that order. Then check in with me on which step from `NEXT_STEPS.md` to start on. Don't start coding until I confirm the step. Don't assume anything not stated in those three files; ask if it's missing.
