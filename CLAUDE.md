# Mirror NYC HQ

You're working with **Jimmie Baugh**, Senior Producer at Mirror NYC, an experiential events agency in NYC. He's building **Mirror NYC HQ**, an internal web app that replaces scattered Google Sheets and Drive folders with a relational, Notion-style central database, plus two embedded modules (**Talent Scout**, **Venue Scout**) for hiring and venue-sourcing workflows.

Jimmie is not a developer. Light HTML/CSS, fluent designing AI workflows. The goal is for you to do the heavy lifting (backend + frontend) while he drives architectural decisions and design direction. **As of 2026-05-08, all UX/UI work happens directly in Claude (Cowork for wireframing + design specs, Code desktop app for implementation). Lovable is no longer used.** Jimmie runs Claude Code via the desktop app (not terminal) -- he opens the project folder directly in the app. Never instruct him to use `cd` or `claude` shell commands to start a session. New surfaces extend the design system Talent Scout established -- see `docs/design-system.md` for canonical layout, component, and behavioral patterns.

## How to talk to Jimmie

- Casual, direct, friend-who-knows-this-stuff tone.
- **No em dashes anywhere.**
- No filler affirmations ("Great question!", "Absolutely!", etc.).
- Concise by default; go deeper when the task calls for it.
- Recommend, don't just present options. Give your read with the tradeoff stated plainly.
- Reference only the latest version of anything he's submitted; if something changed, the old version is gone.
- Don't fill in gaps. If something is unclear or missing, ask him.

Full conventions in `docs/conventions.md`.

## Where to find things

This file is a lean index. Specialized docs in `docs/` are the source of truth for each topic. Read the relevant one before starting work.

| Topic | Doc | What's in it |
| --- | --- | --- |
| Stack, hosting, routing, project layout | `docs/architecture.md` | React + Vite + Supabase + Netlify; monolith with `/talent-scout` and `/venue-scout` routes; where files live. |
| Database schema | `docs/schema.md` | Every table, column, enum, trigger. Single source of truth. Update in the same commit as schema migrations. |
| Auth, RLS, storage, service account | `docs/auth-model.md` | Permission roles (member/producer/admin), RLS policies, storage buckets, Google service account, Edge Function self-invocation auth pattern. |
| Edge Functions | `docs/edge-functions.md` | Every `ts-*` / `vs-*` / cross-cutting function, its signature, and `verify_jwt` posture. Includes the `callClaude` wrapper. |
| Cron jobs | `docs/cron-jobs.md` | `pg_cron` schedules, watchdog pattern, what each job does. |
| Conventions | `docs/conventions.md` | How to write migrations, edge functions, components. Naming, tone, git. **Read before making changes.** |
| Design system | `docs/design-system.md` | Tokens, layout, type, components, behavioral patterns. Canonical reference for any new HQ surface. **Read before designing any new page or component.** |
| Decisions | `docs/decisions.md` | Architectural decisions with rationale, indexed by phase. Why bulk re-eval overwrites but single re-eval appends, why `promote` → `interview`, etc. |
| Operations | `docs/operations.md` | Day-to-day commands (migrate, deploy, regen types, tail logs) + common debugging recipes. |
| Roadmap | `docs/roadmap.md` | Phase-by-phase plan. Finished phases summarize to one line; the active phase has full detail. |
| Talent Scout port plan | `docs/talent-scout-port-plan.md` | Phase 3.1 inventory: lift/adapt/rewrite/drop, schema diff, sub-phase sequence. Drives Phase 3.2 through 3.8. |
| Living state | `CHECKPOINT.md` | Latest commit, current phase, what's deployed, recent migrations, known drift. **Update every commit to main.** |
| Session playbook | `docs/working-with-claude.md` | How to set up Cowork + Code sessions effectively for HQ work. Subagent definitions, hook configs, slash commands, anti-patterns to avoid. **Read at the start of any new phase.** |

## Quick orientation

- **Monolith.** One repo, one app, one DB. Talent Scout and Venue Scout are routes inside HQ, not separate apps.
- **Stack:** React + Vite + TS + Tailwind + shadcn/ui (frontend), Supabase Postgres + Edge Functions + Storage + Realtime (backend), Netlify (hosting), Anthropic API + Google Workspace via service account (integrations).
- **Production URL:** `hq.mirrornyc.com` → `mirrornyc-hq.netlify.app`.
- **Supabase project ref:** `amipjjmphblfxpghjnel`.
- **Service account:** `mirror-ny-hq-backend@mirror-nyc-hq.iam.gserviceaccount.com` with domain-wide delegation across `gmail.readonly`, `gmail.send`, `drive`, `presentations`.

## Current phase

See `CHECKPOINT.md` for live state. As of this writing: **Phase 4.10.2-port (matrix UX overhaul)** squashed onto `vs-port-fresh` at `a36eb3d` (prior 4.10.1-port at `1ac3f6f`). Producer can now correct any field on any venue inline on SourcingReport / Shortlist / DeckPrep -- name, address, neighborhood, features (textarea) on Report + Shortlist; name + address + neighborhood + size + capacity + website + overview on DeckPrep. `<SourcePill>` (new primitive) shows Uploaded / Sourced / Manual at the bottom of the Venue | Address cell. The Alignment column is gone from the matrix; Rank moved into the new `<VenueIdentityStack>` (name -> divider -> address -> divider -> rank -> pill). Manual venues pin to the TOP of the matrix. `EditableVenueName` generalized to `EditableField` with style variants. `vs_candidate_venues.derived_attrs` stays in DB; UI just stops rendering. Pure frontend (no edge function or schema work). Next: **Phase 4.10.3-port** (URL validation hotfix + per-venue enrichment progress + consolidated polish) per `docs/venue-scout-port-plan.md`. The failed-attempt Phase 4 stack on `main` (Scout Dashboard through Deck Prep + URL-quality hot patch) is archived; do not extend it.

## Working with this repo

1. **Before making changes**, scan `docs/conventions.md` and the topic-specific doc for what you're touching.
2. **Schema changes** → write the migration, regenerate types (`supabase gen types typescript --linked`), update `docs/schema.md` in the same commit.
3. **New Edge Function** → think through whether it self-invokes; if yes, set `verify_jwt = false` and use `requireInternalOrUserAuth`. See `docs/auth-model.md`.
4. **Anthropic calls** go through `callClaude(app, ...)` from `_shared/anthropic.ts`. Never raw fetch.
5. **After merging to main**, update `CHECKPOINT.md` (latest commit, recent commits, known drift).
6. **Phase boundaries** → summarize the finished phase to one line in `docs/roadmap.md`, expand the next phase with full detail.
7. **Decisions worth preserving** → add to `docs/decisions.md` with rationale, don't bury in commit messages.
8. **Deploy policy (Phase 3.X — active).** Netlify charges credits per deploy. All Phase 3.X feature work lives on a feature branch (e.g. `phase-3-7-candidates-ux`). Commits stay local; the only Netlify-deploy event per phase is the eventual squash-merge to `main`, and Jimmie has to explicitly approve that. Do NOT push to `main` or to any remote feature branch (origin pushes can fire deploy previews) until Jimmie says go. Edge function deploys (`supabase functions deploy`) and DB migrations (`supabase db push --linked`) are out-of-band and fine to apply during feature work — they don't burn Netlify credits.

## Notes

- Jimmie's git commit author email: `jimmie@jimmiebaugh.com`. His Mirror NYC email is the auth identity, not the commit identity.
- Working pattern (as of 2026-05-08): Jimmie drafts wireframes + design specs in his Cowork session, then pastes the spec into Code as the implementation prompt. UI/UX no longer scaffolded in Lovable; all design happens in Claude. New surfaces extend Talent Scout's patterns per `docs/design-system.md`.
- HQ Lovable draft was discarded; we started fresh in Phase 2.1.
- Talent Scout source repo (`mirror-talent-scout`) is cloned locally; reference for Phase 3 only. New design work for Phase 4 / 5 happens in Claude, not by porting from Lovable.
