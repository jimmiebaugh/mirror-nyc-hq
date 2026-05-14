# Code observations

Living log of noteworthy things Claude or anyone notices while working in the codebase. Intent is passive: log it here, keep moving, triage later during a calm afternoon. The file persists across sessions.

## Format

Each section below is a table. Columns:

| # | Date | File | Hash | V | R | Severity | Note |

- **#**: monotonically increasing within the section. Append-only. Never reorder.
- **Date**: YYYY-MM-DD when logged.
- **File**: path relative to repo root. Include line number when useful (`src/foo.tsx:42`).
- **Hash**: introducing commit's short hash, backtick-wrapped, from `git blame -L <line>,<line> <file>`. Use `n/a` for non-code observations.
- **V**: `☐` unverified, `☑` verified (someone confirmed the observation is real).
- **R**: `☐` open, `☑` resolved (fix landed, or observation retracted with strikethrough).
- **Severity**: `[low]`, `[med]`, `[high]`. High = probable bug or security smell; med = consistency or clarity issue; low = polish.
- **Note**: one sentence. Add a `(retracted: reason)` suffix if retracting.

## Lifecycle

1. Claude or anyone logs an observation. New rows start V `☐`, R `☐`.
2. A verifier reads the code and either confirms (V `☑`) or retracts (strikethrough the row, append `(retracted: reason)` to the Note).
3. When a fix lands, mark R `☑` and link the commit hash in the Note.

Append-only. Never delete rows. Never reorder.

## What to log

Only things actually encountered during a task. Do not go hunting:

- **Unfinished implementations**: TODOs, stubs, placeholder logic, partially implemented features.
- **Dead code**: unused functions, unreachable branches, commented-out blocks.
- **Possible bugs**: unchecked errors, race conditions, off-by-ones, logic errors.
- **Unusual patterns**: inconsistent conventions, surprising workarounds, anti-patterns.

---

## Frontend

(React + Vite + Tailwind + shadcn/ui. Talent Scout, Venue Scout, HQ Core surfaces.)

| # | Date | File | Hash | V | R | Severity | Note |
| --- | --- | --- | --- | --- | --- | --- | --- |

## Edge Functions

(Supabase Edge Functions in `supabase/functions/`. `ts-*`, `vs-*`, `_shared/`.)

| # | Date | File | Hash | V | R | Severity | Note |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 2026-05-14 | `supabase/functions/vs-research-venues/index.ts:601-621` | `49e03e6` | ☑ | ☐ | [med] | Duplicate-invocation race confirmed live (scout 25b5c921, 4 boots / 2 parallel callClaude runs same scout id); the in_flight check reads `brief_data.research_started_at` then writes it non-atomically, so concurrent invocations both pass before either records the kickoff. Downstream CAS guards mask the DB-write conflict but double-spend tokens. Carry-forward from 2026-05-13 cutover; proper fix is a Postgres advisory lock or a kickoff CAS on `research_started_at`. |

## Database

(Migrations, schema, RLS, triggers, RPCs.)

| # | Date | File | Hash | V | R | Severity | Note |
| --- | --- | --- | --- | --- | --- | --- | --- |

## Build & Tooling

(Vite config, Tailwind config, tsconfig, scripts, Netlify config, package.json.)

| # | Date | File | Hash | V | R | Severity | Note |
| --- | --- | --- | --- | --- | --- | --- | --- |

## Docs

(`docs/`, root-level markdown.)

| # | Date | File | Hash | V | R | Severity | Note |
| --- | --- | --- | --- | --- | --- | --- | --- |

## Other

(Catch-all for anything that does not fit.)

| # | Date | File | Hash | V | R | Severity | Note |
| --- | --- | --- | --- | --- | --- | --- | --- |
