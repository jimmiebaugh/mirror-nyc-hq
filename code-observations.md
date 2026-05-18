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
| 1 | 2026-05-14 | `src/lib/venue-scout/briefForm.ts` (`computeOverviewSourceHash`) | `n/a` | ☑ | ☐ | [low] | Phase 4 Revision pass 3: the overview-staleness hash includes `budget_text` + `expected_guest_count` as raw producer display strings, while the server (`vs-generate-brief-overview`) recomputes them from the canonicalized DB number; if a producer types a non-canonical form (comma in guest count, missing `$` in budget) and resubmits within the same in-memory session before any `fromScout` re-seed, the hashes diverge into one wasted (self-healing) Claude regen. Bounded per spec § 3 risk tolerance; flagged by code-reviewer, deferred. Proper fix: hash `toUpdate(state)` output (the DB representation) instead of raw form strings. (5.8.2 triage: verify-and-defer to Phase 5.10 Venue Scout review. Self-healing one wasted regen, producer never sees corruption; lift only if a producer surfaces the wasted-regen turnaround as a real annoyance.) |
| 2 | 2026-05-16 | `src/lib/hq/useClientsAndVendors.ts` | `523e1d6` | ☑ | ☐ | [low] | New composite-lookup hook for the PeopleList Organization filter has `useEffect` dep `[]`, so the clients+vendors picker loads once on mount and never refreshes. Creating a new Client / Vendor in another tab and navigating back to People won't surface it in the filter picker until a full page reload. Acceptable for Phase 5.2; revisit if Saved Views with Organization chips ship + cross-tab staleness becomes a real UX issue. (5.8.2 triage: verify-and-defer. No saved views with Organization chips exist through Phase 5.7.x, so the cross-tab staleness window has no production trigger yet. Pairs with Frontend #3; both unlock together when Organization-chip saved views become a real need.) |
| 3 | 2026-05-16 | `src/components/data/FilterBar.tsx` (`chipDisplayValue`) | `523e1d6` | ☑ | ☐ | [low] | When a saved view restores a lookup chip before its `lookupOptions` array has loaded, the chip momentarily renders the raw uuid before the hook resolves and re-renders with the name. No saved Organization-chip views exist in 5.2 cleanup (only the default `type=Client` chip is preset), so the race window is currently theoretical. Worth revisiting if Saved Views grow to persist Organization chips. (5.8.2 triage: verify-and-defer. Race window still has no production trigger as of Phase 5.7.x. Pairs with Frontend #2; both unlock together when Organization-chip saved views become a real need.) |
| 4 | 2026-05-16 | ~~`src/pages/calendar/CalendarPage.tsx` (event rendering)~~ | ~~`n/a`~~ | ☑ | ☑ | ~~[low]~~ | (retracted: code-reviewer cold pass flagged the dead CSS; in-commit fix widened `CalendarEventKind` to include `"olk" + "hol"` so the new modifier classes are wired up. Outlook and Holiday banners now render with the distinct gray-tones spec § 12 prescribed.) |
| 5 | 2026-05-16 | `src/pages/calendar/CalendarPage.tsx` (FilterChip popovers) | `n/a` | ☑ | ☑ | [low] | The Lead + Category filter-chip popovers on the Calendar page do not close on outside click; the user has to click the chip again or pick an item to dismiss. Acceptable for 5.3 (the chips are simple 2-3-item pickers), but the `<FilterBar />` pattern has outside-click handling and the Calendar chips don't. Worth promoting to the FilterBar pattern in a future polish pass. (5.8.2 triage: moot. Phase 5.7.9 (`3d5f1cc`) dropped the Lead + Category filter chips from /calendar entirely; the popover surface no longer exists. Only a stale doc comment at CalendarPage.tsx:45 references the removed chips. See memory `project_calendar_lead_category_chips_dropped.md` + the 5.7.9 COWORK_SYNC archive.) |
| 6 | 2026-05-16 | `src/components/data/CalendarMonthView.tsx` | `n/a` | ☑ | ☐ | [low] | Phase 5.3 extended the component with optional controlled-month props (`activeMonth`, `onActiveMonthChange`) + a `hideInternalNav` flag so the new Calendar page can drive nav from its page header. The component now has two render paths (internal nav vs no nav); the existing Deliverables Calendar view still uses the uncontrolled path. Not a bug, just two code paths where there was one before. (5.8.2 triage: verified; accepted as design choice. Both render paths remain in active use: Deliverables Calendar consumes the uncontrolled internal-nav path; the /calendar surface consumes the controlled `hideInternalNav` path with its own page-header nav. No consolidation planned.) |
| 7 | 2026-05-16 | `src/pages/projects/ProjectDetail.tsx` (`installCountdownIso`) | `n/a` | ☑ | ☐ | [low] | The "Days Until Install" stat tile now prefers the new `install_dates_start` column with a fallback to `live_dates_start` for unbackfilled rows. This is a behavior change for every existing project: the countdown previously showed days-until-live; for projects with no install dates yet it still does. Document for Jimmie so producers aren't surprised when "days until install" stops matching their old mental model once they start filling in install dates. (5.8.2 triage: verified; accepted as designed. Phase 5.3 schema reshape was intentional; behavior is consistent with the install_dates_start column add. Producers transitioning to install-dates see the correct semantics; pre-backfill projects fall back to live-dates cleanly. Communicated to Jimmie at the time.) |
| 8 | 2026-05-17 | multiple HQ surfaces | `n/a` | ☑ | ☑ | [low] | Phase 5.7.3 followup-6 design call (Jimmie): coral (`hsl(var(--primary))`) is reserved for hyperlinks. Only ProjectDetail's Overview Job # value (`text-primary mono`) was flipped to foreground in this pass; other non-link coral usages flagged for a future sweep — `src/components/home/MyWeekStrip.tsx:145` ("My Week" heading), `src/pages/people/PeopleList.tsx:50` (Client tier swatch color), `src/components/calendar/VisibilityPanel.tsx:93` (panel accent), `src/components/data/SavedViewsDropdown.tsx:248` (dropdown accent), `src/components/wiki/WikiNav.tsx:65` (nav accent), `src/components/ui/PermissionDenied.tsx:42` (denial heading). Each needs a per-site call on whether it's an accent-by-design or a stale coral-text holdover. (5.8.2 triage: per-site sweep closed. 3 of 6 flipped in 5.7.14 (`59a5dac`): VisibilityPanel clientName label flipped to foreground; SavedViewsDropdown "default" / "global default" caption flipped to subtle-foreground; PermissionDenied lock badge recolored to destructive (semantic match, not a flip). 3 of 6 kept by design: MyWeekStrip "My Week" heading (5.7.14 refactored the markup to inline style + bumped font-size and intentionally kept the coral as visual emphasis on Home; live at MyWeekStrip.tsx:164); PeopleList Client tier swatch (tier identity color matching the Affiliation pill scheme); WikiNav "+ New Page" (it IS a `<Link>`, coral correct per `feedback_coral_reserved_for_hyperlinks.md`).) |

## Edge Functions

(Supabase Edge Functions in `supabase/functions/`. `ts-*`, `vs-*`, `_shared/`.)

| # | Date | File | Hash | V | R | Severity | Note |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 2026-05-14 | `supabase/functions/vs-research-venues/index.ts:601-621` | `49e03e6` | ☑ | ☐ | [med] | Duplicate-invocation race confirmed live (scout 25b5c921, 4 boots / 2 parallel callClaude runs same scout id); the in_flight check reads `brief_data.research_started_at` then writes it non-atomically, so concurrent invocations both pass before either records the kickoff. Downstream CAS guards mask the DB-write conflict but double-spend tokens. Carry-forward from 2026-05-13 cutover; proper fix is a Postgres advisory lock or a kickoff CAS on `research_started_at`. (5.8.2 triage: verify-and-defer to Phase 5.10 Venue Scout review. High-cost fix (advisory lock or kickoff CAS); downstream CAS guards mask the DB-write conflict but token double-spend remains. 5.10 is the natural slot for the rewrite to land alongside other Venue Scout passes.) |
| 2 | 2026-05-14 | `supabase/functions/vs-generate-brief-overview/index.ts` (`hashFormatBudget`) | `n/a` | ☑ | ☐ | [low] | Phase 4 Revision pass 3: client (`briefForm.ts`) + server budget canonicalization for the overview-source hash both rely on `Number.prototype.toLocaleString("en-US", ...)`; identical on V8 (browser + Deno) today but a silent parity risk if either runtime's ICU output ever shifts. Flagged by security-auditor + code-reviewer, deferred; a pure-JS comma formatter would remove the runtime coupling. (5.8.2 triage: verify-and-defer. Silent parity risk only; both runtimes are V8 so ICU output is identical today and divergence has not surfaced. Lift only if ICU divergence actually shows up, which is unlikely; pure-JS comma formatter is the easy lift when it does.) |

## Database

(Migrations, schema, RLS, triggers, RPCs.)

| # | Date | File | Hash | V | R | Severity | Note |
| --- | --- | --- | --- | --- | --- | --- | --- |

## Build & Tooling

(Vite config, Tailwind config, tsconfig, scripts, Netlify config, package.json.)

| # | Date | File | Hash | V | R | Severity | Note |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 2026-05-17 | `src/integrations/supabase/types.ts:1` | `c29c8bd` | ☑ | ☑ | [med] | The committed types.ts since Phase 5.6.3 starts with a `Initialising login role...` line (stderr from the supabase CLI captured into the file by the `> types.ts` redirect when stderr wasn't suppressed). The file is unparseable so `tsc --noEmit` errors out on every line of types.ts and never reaches the rest of the codebase. Vite build still passes because Vite skips type-checking by default. Resolved during the Phase 5.6.5 regen (`supabase gen types typescript --linked 2>/dev/null > types.ts`); the resulting clean parse exposed 14 pre-existing TS errors in unrelated files (TaskDetail, VendorDetail, VenueDetail, ProjectDetail, ClientDetail, PersonDetail, DeliverableDetail, TeamMemberEdit, SettingsPage, PullDetail, ErrorState, lookups.ts, vendors/queries.ts) that the corruption was masking. Those errors are out-of-scope for 5.6.5; flagging as a follow-on cleanup pass. |

## Docs

(`docs/`, root-level markdown.)

| # | Date | File | Hash | V | R | Severity | Note |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 2026-05-16 | `docs/schema.md` | `n/a` | ☑ | ☐ | [med] | Schema doc still describes the pre-5.2.3 unified `organizations` table; the 5.2.3 split into vendors + clients was never reflected in a structural rewrite (only callout notes were added in Phase 5.2 cleanup `523e1d6` for the cleanup-specific column add + GRANT fix). Canonical column lists currently live in the migration files + `src/integrations/supabase/types.ts`; a full schema.md rewrite reflecting the split shape + the new `vendor_capabilities`, `vendor_categories`, `cities`, `project_categories` lookup tables is doc-debt carried forward to a future polish pass. Code-reviewer flagged in 5.2 cleanup. (5.8.2 triage: verify-and-defer to Phase 5.8.3. Explicit slot in 5.8.3 (MD doc audit + cleanup pass). This is the biggest known target for that pass per `OUTPUTS/phase-5-8-plan.md`.) |
| 2 | 2026-05-16 | `docs/working-with-claude.md` (§ 4.5) | `523e1d6` | ☑ | ☑ | [low] | The Phase 5.2 cleanup amendment reordered the squash flow so the SHIPPED block in `OUTPUTS/COWORK_SYNC.md` is written (step 5d) BEFORE Jimmie runs the manual `git push origin main` (step 5e). If Jimmie reviews the local commits and decides NOT to push, the SHIPPED block already claims the work shipped; a subsequent Cowork session reading that file would get stale state until the next AWAITING-block overwrite. Mitigated by the block's self-documenting "pending push" line, but worth revisiting if the manual-push step becomes a frequent abort point. Resolved by `85cb765`: pre-added `Bash(git push origin main)` permission rule to `.claude/settings.json`; § 4.5 restructured so step 5c is autonomous push and step 5e SHIPPED-block overwrite happens AFTER push lands. |
| 3 | 2026-05-16 | `docs/working-with-claude.md` (§ 4.5 step 5c) | `1c21ea9` | ☑ | ☑ | [med] | The Phase 5.3 ship discovered that Netlify evaluates `[skip netlify]` against the HEAD commit of each push, not per-commit. The original § 4.5 step 5c put the squash commit + the `[skip netlify]` CHECKPOINT backfill in the same `git push origin main`; Netlify saw `[skip netlify]` at HEAD and skipped the entire push, leaving the squash deploy-worthy but un-deployed. Jimmie triggered the deploy manually. Resolved by splitting step 5c into 5b (push the squash alone, deploy fires) + 5d (push the backfill alone, correctly skipped). New § 4.5.b documents the Netlify trigger semantics + the empirical confirmation. |

## Other

(Catch-all for anything that does not fit.)

| # | Date | File | Hash | V | R | Severity | Note |
| --- | --- | --- | --- | --- | --- | --- | --- |
