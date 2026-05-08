# Decisions (session-handoff)

This file is a session-level scratchpad for in-flight decisions. Long-lived architectural decisions live in `docs/decisions.md`.

## Phase 3.7 — archived

All Phase 3.7 decisions migrated to `docs/decisions.md` (Phase 3.7 section) on 2026-05-08, post-squash-merge.

Key items now in `docs/decisions.md`:
- `manually_reviewed` boolean as one-way flip; `auto_rejected` enum value deprecated.
- Referral identity = original applicant; `referrer_email` captures the manager.
- Forward parser walks every chain segment, picks deepest non-Mirror.
- Capture every `@mirrornyc.com` manager's commentary into `internal_notes`.
- `mirrornyc.com` blocked from portfolio URL extraction.
- Global competitor list as `text[]` on `global_settings`.
- Stepped pull-running checklist driven by existing signals, not new step_progress writes.
- Toasts default to Mirror coral; ReferralPill stays electric blue.
- Slider track + score bar track use `bg-input` on Mirror-grey card surfaces.
- Top nav reduced to Dashboard + Talent Scout.

## Phase 3.8 — open

Decisions worth flagging will accumulate here as 3.8 work happens. Empty at session start.

## Tone / process (Jimmie)

- Casual, direct. No filler affirmations. **No em dashes anywhere.**
- Recommend, don't present options.
- Reference only the latest version. If we iterated, the old version is gone.
- Don't fill gaps. Ask if unclear.
