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
