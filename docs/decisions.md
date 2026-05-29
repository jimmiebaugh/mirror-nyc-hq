# Decisions

Architectural decisions worth preserving with their rationale. Newest at the top within each section.

## Phase 5.16.1.2: Supabase advisor focused + 5.16.1.1 carry-forwards (2026-05-28, complete)

Squash: folded into the Phase 5.16 consolidation squash (placeholder `<pending consolidation squash>`). Part three (final) of the three-way 5.16.1 split: the focused Supabase Studio advisor fixes bundled with the 5.16.1.1 carry-forwards. One consolidated migration (`20260612000000_phase_5_16_1_2_advisor_focused.sql`, applied out-of-band, migration-reviewer GO); the `xlsx` high vuln + `qs` moderate vuln closed; Database types generated into the Deno tree; `logClaudeUsage` dead code pruned. Phase B name-schema lock + the 17 parity redeploys are staged behind a human-in-the-loop gate. Closes the 5.16.1 cycle; next is 5.17 final smoke.

### D1: Bulk-import RPC GRANT lockdown = service_role only (advisor 0028/0029)

The four bulk-import RPCs (`bulk_import_commit_projects/vendors/venues(jsonb)`, `bulk_import_undo(uuid,uuid,boolean)`) were `GRANT`ed to `authenticated` on every historic `CREATE OR REPLACE` (7+ migrations), plus the implicit PUBLIC grant. They are invoked ONLY by `supabase/functions/bulk-import/index.ts` via a `SUPABASE_SERVICE_ROLE_KEY` client (the edge function gates `permission_role='admin'` through a user-client first, then calls the RPCs through `adminClient`). Zero frontend `.rpc()` callers; no RLS policy references them (checked per [[feedback_revoke_execute_check_rls_callers]] — they are commit functions, not predicate helpers). So `REVOKE EXECUTE FROM PUBLIC, anon, authenticated` + `GRANT EXECUTE TO service_role` is safe and clears both advisor flags. The in-function `actor_id` admin re-check stays as defense in depth (third gate after AdminRoute + the edge-function server-side re-check). Pattern lifted from Phase 5.12.1's `vs_research_try_acquire_kickoff`.

### D2: users_align_id_to_auth KEEPS its `authenticated` grant (spec deviation, approved)

Spec §3b proposed revoking `authenticated` from `users_align_id_to_auth`, claiming Team-page pre-provision runs via the service-role client. It does NOT: `src/pages/team/TeamMemberEdit.tsx:171` inserts the pre-provisioned user row from the browser as `authenticated`, which fires the BEFORE INSERT `trg_users_align_id_to_auth` in the `authenticated` role context. Trigger-function EXECUTE IS enforced in this Supabase project (the root cause of the 2026-05-19 sign-in lockout, Phase 5.8.8). Revoking would break add-member with the same failure class. `auth-model.md` Phase 5.8.8 hardening notes already document this ("Team-page INSERTs run as `authenticated`"); the spec misread its own source. Resolution (Jimmie 2026-05-28): revoke only `anon` + `PUBLIC` (clears advisor 0028); keep `authenticated` + `service_role`; the residual 0029 (authenticated-callable) flag is documented as intentional, exactly parallel to `users_protect_admin_columns`.

### D3: users_protect_admin_columns grant preserved (authenticated + supabase_auth_admin)

Re-asserted the known-good Phase 5.8.8 ACL (`REVOKE FROM PUBLIC, anon`; `GRANT TO supabase_auth_admin, authenticated`). The BEFORE UPDATE trigger fires on user-row UPDATEs from `authenticated` callers (Profile Settings, Team-page edits) and on the swap UPDATE inside `handle_new_user` (`supabase_auth_admin`). The residual advisor 0029 flag is informational + intentional. Both `users_align_id_to_auth` (D2) and `users_protect_admin_columns` are documented in `auth-model.md` § "Intentional SECURITY DEFINER advisor warnings."

### D4: RLS policy init-plan wraps (bulk_import_drafts + anthropic_call_log)

Two policies wrapped `auth.uid()` in `(select auth.uid())` so the planner evaluates it once per query (InitPlan) instead of once per row (advisor 0003). `bulk_import_drafts_author_all` (FOR ALL; the column is `author`, NOT `author_id` as the spec guessed) and `anthropic_call_log_admin_read` (FOR SELECT, EXISTS-on-users). Behavior-identical; query plan improves. `DROP POLICY IF EXISTS` + `CREATE POLICY` per the Phase 5.8.5 `credentials_*` pattern; byte-faithful to the originals except for the wrap.

### D5: Selective FK indexes (6) — chosen by real query patterns, plain CREATE INDEX

Six FK columns got indexes. Each is genuinely unindexed: every join-table PK leads with the OTHER column (`project_account_managers` / `project_designers` / `project_venues` PKs lead with `project_id`; `vendor_ratings` PK leads with `vendor_id`), and `notes_log_parent_idx` / `vendor_ratings_vendor_idx` don't cover `author_id` / `user_id`. Targets: `project_account_managers.user_id`, `project_designers.user_id`, `vendor_ratings.user_id`, `users.department_id`, `notes_log.author_id`, `project_venues.venue_id` (the (project_id, venue_id) composite does NOT cover the venue→project reverse lookup). Used plain `CREATE INDEX IF NOT EXISTS`, not `CONCURRENTLY`: `supabase db push` wraps migrations in a transaction (CONCURRENTLY can't run inside one), and the write-time lock window is negligible at Mirror's row counts.

### D6: Unused-index advisor warnings (~25) deferred

Determination is fragile at low scale: indexes like `idx_anthropic_call_log_app_fn_created` (spend-rollup hot path) and most list-page filter indexes haven't accumulated meaningful `pg_stat_user_indexes.idx_scan` stats yet under producer load. Revisit in a post-team-rollout pass once scan counts reflect real query patterns. No drops this phase.

### D7: Audit-column unindexed-FK warnings (~30) deferred

The `_created_by_fkey` / `_updated_by_fkey` audit columns are filled by triggers and never filtered on in any UI surface. Index cost isn't justified by current query patterns. Verify-and-defer; revisit if a future audit/reporting surface starts filtering on them.

### D8: RLS helper schema relocation deferred

Relocating the RLS helper functions (`is_admin`, `is_active_member`, `is_producer_or_admin`, `current_user_role`) to an `internal` schema (so they'd drop off the advisor's authenticated-callable list) would require rewriting every RLS policy that references them — large blast radius, not warranted by the warning level. The `authenticated` EXECUTE grant is required for RLS predicate evaluation; the only info these leak when called directly via PostgREST RPC is self-status ("am I admin?"). Acceptable risk; documented as intentional in `auth-model.md`. Defer relocation to a future focused refactor.

### D9: Auth DB connections flipped to percentage-based allocation

The Supabase dashboard Auth-server DB connection allocation was switched from absolute (10) to percentage-based (Project Settings → Database → Connection Pooling) by Jimmie 2026-05-28, before this squash landed (advisor INFO `auth_db_connections_absolute`). Dashboard-only; no migration, no code.

### D10: xlsx → SheetJS lazy CDN import (high vuln closed, lazy-load preserved)

The npm `xlsx@0.18.5` carried unpatched prototype-pollution + ReDoS advisories with no npm fix. Replaced with a lazy dynamic import of SheetJS's patched CDN ESM build (`https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs`) inside `src/lib/hq/bulkImport/parseWorkbook`, removing `xlsx` from `package.json` (clears `npm audit`). Chose the lazy dynamic-import route over the spec's recommended top-level `<script>` tag (Jimmie 2026-05-28): the parser deliberately lazy-loaded the library (only on .xlsx upload), and a `<script>` tag would load SheetJS eagerly on every page for every user, regressing that. The CDN ESM build's API surface (`read`, `utils.sheet_to_json`) is identical to the npm package's for these calls. A narrow ambient declaration (`src/types/sheetjs-cdn.d.ts`) types the URL import so no `@types/xlsx` dependency is needed; `@vite-ignore` keeps the URL specifier external. No CSP exists, so no allowlisting needed. Tradeoff: the .xlsx parse path now needs network at upload moment (the CSV/TSV path never touches the network). **Producer-format reality:** `.xlsx`/`.xls` support is preserved (UploadStep accepts `.csv,.tsv,.xlsx,.xls`; venue-scout SheetUploadCard accepts pdf/xlsx/csv via the server-side `vs-parse-sheet` path); whether producers upload xlsx vs csv in practice is unconfirmed but moot since both paths keep working. Live xlsx-upload smoke (needs an admin browser session + a real .xlsx) deferred to Jimmie. **Companion finding (code-reviewer):** the edge parser `vs-parse-sheet/index.ts:51` still imports the same vulnerable `https://esm.sh/xlsx@0.18.5` server-side (`code-observations.md` Edge #21) — `npm audit` only covers the npm tree, not Deno esm.sh imports. **Folded into this phase (Jimmie 2026-05-28), via vendoring after the CDN route failed:** pointing the `vs-parse-sheet` import at `https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs` (mirroring the frontend) was attempted but the Supabase edge **deploy bundler rejects that host** ("Cannot import from cdn.sheetjs.com:443"). The frontend is unaffected — it builds through Vite and imports the CDN at browser runtime (`@vite-ignore`), a different code path than the server-side Deno bundler. Resolution (Jimmie's call): vendored SheetJS's patched 0.20.3 ESM build into `supabase/functions/_shared/vendor/xlsx.mjs` (+ a provenance README) and imported it locally from `vs-parse-sheet` (`../_shared/vendor/xlsx.mjs`) — the bundler bundles local files fine; the vendored `.mjs` is eslint-ignored (`supabase/functions/_shared/vendor/**` in `eslint.config.js` — eslint's default JS handling otherwise lints `.mjs`). Deployed to prod 2026-05-28; the server-side xlsx vuln is closed (Edge #21 resolved). A PDF/xlsx/csv parse smoke is recommended to confirm 0.18.5→0.20.3 parity (API-identical, low risk). Standing note: **Supabase edge functions can't import from arbitrary CDN hosts at deploy time — use esm.sh / `npm:` / `jsr:` / a vendored local file.**

### D11: qs moderate vuln auto-fixed

`npm audit fix` bumped the transitive `qs` (via `googleapis` → `googleapis-common`) to 6.15.2, closing the moderate DoS advisory (GHSA-q8mj-m7cp-5q26). `googleapis@171.4.0` unchanged. `npm audit` now reports 0 vulnerabilities.

### D12: Database types generated into the Deno tree; existing narrow interfaces left as-is (Edge #18)

Generated `supabase/functions/_shared/database.types.ts` (3061 lines, matches the frontend `src/integrations/supabase/types.ts` schema; via `/tmp` + `test -s` + `mv` per the edge-tree CLAUDE.md rule). This closes Edge #18 (no generated `Database` types existed in the Deno tree). Did NOT retrofit existing edge `.select()` callsites: investigation found the hand-rolled interfaces are intentionally narrow (`RoundRow = {id, round_number}`, `HqVenueRow`, etc.) or joined/derived shapes that don't map 1:1 to a table Row — replacing them with the full `Database[...]["Row"]` would over-fetch the type surface, which the spec's own §3k step 3 says to avoid. Reinforced by: no local `deno` to typecheck edge adoptions, and edge deploys transpile via swc (no typecheck) so a bad swap wouldn't fail deploy. Forward convention (in `edge-functions.md` + `conventions.md`): new edge functions that select a full row import `Database` from `_shared/database.types.ts` and use `Database["public"]["Tables"][...]["Row"]`; existing intentionally-narrow interfaces are retrofitted opportunistically, not swept. (Reverses 5.16.1.1 D2's "not wired" note — the types are now wired; adoption is the deferred part.)

### D13: Phase B name-schema wording LOCKED (0 wording iterations)

The 5.16.1.1 D10 initial 3-rule rewrite is **LOCKED as-is** — no iterations needed. Jimmie ran a fresh Phase B scout 2026-05-28; the 5 returned sourced names (`Abbot Kinney Storefront`, `Century Park Storefront`, `Culver City Main Street Storefront`, `Robertson Blvd Storefront`, `Santa Monica Blvd Storefront`) all satisfy the three producer rules: (a) no listing-DB citations, (b) no cross-street / "at X" qualifiers, (c) the `<location> Storefront` shape for unbranded vacancies. Locked on Jimmie's confirmation 2026-05-28. Closes `code-observations.md` Edge #13. The same run exercised the deployed `buildFillUserMsg` enrichment path end-to-end without error (Edge #11, resolved 5.16.1.1).

### D14: HQ Bulk Import header→key normalization (carry-over bug fix, folded in)

The 5.16.1.2 smoke surfaced that the Bulk Venue Import Review grid rendered the correct row count with every cell BLANK for any uploaded sheet whose headers didn't exactly match the internal column keys (Jimmie was uploading a modified template). Root cause (NOT a regression — the contract has held since the Phase 5.9 bulk-import primitive; a code-reviewer + general-purpose trace reproduced the parser against the shipped templates and confirmed the carry-over / grid / virtualizer code is correct + byte-unchanged): the whole pipeline reads `row[col.key]`, the templates use the internal keys verbatim as CSV headers, and there was NO header→key normalization — so a modified / friendly-header sheet produced rows keyed by the raw headers and every `row[col.key]` read `undefined`. Jimmie confirmed the correct template fills in. Fix (folded into 5.16.1.2 per Jimmie 2026-05-28), in two layers: (1) **auto-match** — `buildAutoHeaderMapping` (new `src/lib/hq/bulkImport/normalizeHeaders.ts`) seeds a header→`col.key` map by normalized token (lowercase + non-alphanumerics stripped) against both `col.key` and `col.label`, key-wins-on-collision, so `name` / `Name` / `venue_types` / "Venue Types" auto-resolve; (2) **manual column-mapping UI** — the smoke surfaced that synonyms the token match can't safely guess ("Venue" → Name, "Venue Type" → Venue Types, "Size" → Square Footage) had no remedy (the Map step only resolves client/venue/staff references), so `UploadStep` now renders an editable mapping table (each uploaded header → a field dropdown; auto-matches pre-filled; "Don't import" default for the rest) with a required-field-unmapped guard, a duplicate-target warning, and a live preview of the mapped result. `applyHeaderMapping` re-keys the rows per the final (auto + manual) mapping, pushed downstream via `onParsed` so the whole pipeline (ref enumeration, ImportGrid, dedupe, validation, commit) sees entity-keyed rows. Placement = Upload step (Jimmie 2026-05-28: fix it where the mismatch surfaces; cleanest data flow since the mapping is finalized before any downstream step runs). Entity-agnostic (project / vendor / venue all benefit). 9 unit tests (`src/test/normalizeHeaders.test.ts`). Closes `code-observations.md` Frontend #50. v1 limitation: re-mapping after leaving the Upload step needs a re-upload (the raw sheet isn't persisted into wizard state; on re-entry the step shows a read-only preview) — acceptable for the admin-only flow.

## Phase 5.16.1.1: Codebase triage / full sweep (2026-05-28, complete)

Squash: folded into the Phase 5.16 consolidation squash (placeholder `<pending consolidation squash>`). The "burn the baseline to zero" pass: lint 191 → 0 (frontend 30 + edge 161), 30 open `code-observations.md` rows closed, the 5.16.0 + 5.16.1.0 carry-forwards, and three UI/data lifts. Part two of the three-way 5.16.1 split. One migration (briefs storage-policy dedupe); four edge functions redeployed out-of-band (`vs-research-venues`, `vs-compile-summaries`, `vs-research-single-venue`, `vs-parse-sheet`).

### D1: Lint baseline burned to zero, full repo; edge functions permanently back in the lint contract

5.16.1.0 had scoped `supabase/functions/**` out of `eslint.config.js`. 5.16.1.1 reverts that: the edge tree returns to the frontend lint contract permanently, and the full-repo baseline (191 = 165 errors + 26 warnings) burns to zero. The `no-explicit-any` debt was real, not noise; keeping the edge tree linted stops it re-accumulating. The sweep used REAL typing (Anthropic `ClaudeResult`/`ClaudeResponseBlock` shapes, hand-rolled narrow Google Drive/Slides REST interfaces, narrow row projections, `unknown` + guards for open payloads, `catch (e: unknown)` + narrowing) with ZERO inline eslint-disables (the ~5 cap was never approached). A cold review of the edge diff caught 2 catch-narrowing fidelity regressions (`e?.message ?? String(e)` semantics), corrected to preserve byte-identical error output.

### D2: Edge typing pattern (no generated Database types in the Deno tree)

The edge functions do NOT import the generated `Database` types (those live in the frontend `src/integrations/supabase/types.ts`; routing that through esm/Deno resolution is not wired). The convention, reaffirmed by the sweep: an untyped service client (`ReturnType<typeof createClient>`) plus hand-rolled narrow interfaces / inline casts per `.select(...)`. Consequence: edge row reads are effectively `any`-shaped at the type level with no tsc/deno gate, so projection mismatches are invisible. Logged as code-observations Edge #18 for a future "wire Database types into the edge tree" pass.

### D3: ProjectDetail.tsx split = ProjectDetail only (Round 1, locked B)

ProjectDetail.tsx (1426 → 907 lines) split into presentational siblings under `src/components/projects/` (ProjectDetailsCard, ProjectTeamSection, ProjectVendorsCard, ProjectActivitySection). PURE presentational extraction: every hook/effect/handler/optimistic-update/dep-array stays in the parent; children take everything via props (cold-reviewed byte-identical). The `ProjectStatTiles` sibling the spec listed was NOT created: there is no standalone "Days Until Install"/`.stat` tiles row in the current file (it folded into the Schedule card, which stays inline). RoleSettings.tsx + ProjectEdit.tsx (also in #19) stay verify-and-defer; opportunistic extraction on their next touch, not forced in triage.

### D4: venues.contact_* columns kept write-only (Round 2)

The `venues.contact_name`/`contact_email`/`contact_phone` text columns (written by bulk-import, invisible/uneditable in VenueEdit/VenueDetail) stay as-is. The `venue_contact_people` join is the canonical contact link; the text columns are a write-only divergence from the vendor side, not worth a UI surface or a column drop. Documented so a future audit does not re-litigate. (Frontend #11.)

### D5: PersonDetail affiliation type pill keeps Edit-nav (Round 2, verify-and-defer)

The Person Detail title-row type pill navigates to Edit rather than offering inline reassignment. Inline reassignment needs UX for the "type changed -> which FK to clear/set" disambiguation, which does not fit a triage phase. Deferred. (Frontend #28.)

### D6: ClientsList "Active Projects" lifecycle definition

The ClientsList "Active Projects" column counts only projects whose `status` is NOT in `NON_ACTIVE_PROJECT_STATUSES` (Complete / Cancelled / On Hold). Surfaced via a column-header hover tooltip (DataTable gained an optional `headerTitle` prop). The spec said "ProjectsList" but the column lives on ClientsList per the authoritative observation #29; the tooltip went where the column is. (Frontend #29.)

### D7: DateRangePicker HQ lift DEFERRED (reverses the Round 1 "lift to five surfaces" lock)

Round 1 locked lifting DateRangePicker into five HQ surfaces on the assumption it had a `mode` prop and round-tripped `{from,to}` date values. Implementation-time verification found the real component is `value: string` (a formatted DISPLAY string like "Oct 15-17, 2026", built for VS `text` columns) and range-mode only. All five HQ targets use `date` columns / ISO `<input type="date">`, and §4 forbids schema changes, so wiring as-is would write display strings into date columns and break saves. The faithful lift needs a dual-contract (ISO + display) picker extension with a `single` mode, which is bigger than a triage closure. Deferred to its own focused sub-phase (Jimmie 2026-05-28). Frontend #43 + #45 verify-and-defer.

### D8: .tbl canon flip = match the VS matrix primitives, HQ-wide

The global `.tbl` rule now matches the VS matrix Th/Td primitives: thead default flipped left -> CENTER on a `--surface` header bg (opt a column back with `.l`), and the 75%-height vertical cell-divider `::after` bars are now OPT-IN via `.tbl--with-dividers` (the matrix dropped them because they painted over content). Td padding already matched matrix Td (12px 14px); row hover stays the HQ default. `.tbl--matrix` stays STANDALONE (R7 amendment v1 decoupled it for specificity; recoupling would re-bury matrix utilities). List tables (via `.tbl-list .tbl`) already render this contract, so the visible delta is concentrated on the bare-`.tbl` consumers (AccountLogins, ProjectDetail's two inline tables, TeamList, NotificationPreferences, FinalReviewDetail). FinalReviewDetail already uses `.tbl` (the observation's "uses w-full without .tbl" premise was stale). (Frontend #47.)

### D9: Delimiter contract = `/` + `,` universal, `|` accepted during a transition window

Multi-value cell parsing converges on `/` and `,` (the union VS Phase A + frontend `parseTypes` already accept). Legacy `|` is still parsed during a transition window and its consumption is logged (frontend console + edge logs) so the deprecation can be timed later. A shared `splitMultiValue` util (`src/lib/multiValue.ts` + a byte-equivalent `supabase/functions/_shared/multiValue.ts` mirror) is the single source so HQ bulk-import (refEnumerate/splitMulti) and `vs-parse-sheet` (which now splits `venue_type`, re-joining with " / ") cannot drift. CSV templates + the RefResolvedCell placeholder updated to `/`. The transition-comms in-app banner was SKIPPED (owner call: low producer count, `|` still parses, nothing breaks). (Edge #15.)

### D10: Phase B name schema rewrite (3 producer rules); wording iteration expected

The Phase B `submit_research` `name` schema description was rewritten per three producer rules: (1) no listing-database citations in the name (Peerspace/LoopNet/NMRK belong in `website_url`); (2) no cross-street / "at <street>" qualifiers unless part of the verified name; (3) a "<location> <space-type>" identifier ("Sunset Strip Storefront") IS acceptable for unbranded vacancies, reversing the prior "bare address, no 'Storefront' suffix" rule. Initial draft shipped + deployed out-of-band; 1-2 wording iterations expected against a fresh Phase B batch before the wording locks (human-in-the-loop, not auto-iterated). (Edge #13.)

### D11: buildFillUserMsg brief block lift (Edge #11)

`buildFillUserMsg` now surfaces `target_audience` + `vibe_aesthetic` (the two Phase 5.12.5 tag-array brief signals) to the Pass 1 / Phase A enrichment prompt, matching the Phase B `userMsgBriefPrefix` labels + "(not set)" shape. Previously the 5.12.5 array-shape flip only reached Phase B; the shared block omitted them. Deployed out-of-band to its three callers.

### D12: IconStar kept for palette completeness

IconStar (HQIcons.tsx) is exported but unimported; kept as hand-curated-palette completeness (treated like the shadcn re-exports), annotated in place. Prune only if a future pass usage-prunes the icon set. (Frontend #16.)

## Phase 5.16.1.0: Vite 5 to 8 upgrade + tooling pass (2026-05-28, complete)

Squash: folded into the Phase 5.16 consolidation squash (placeholder `<pending consolidation squash>`). Tooling-only: Vite 5.4.19 → 8.0.14 (stepped through 6 + 7 + 8), `@vitejs/plugin-react-swc` 3.11.0 → 4.3.1, Vitest 3.2.4 → 4.1.7, Node floor pinned, eslint scoped off the edge-function tree, esbuild SSRF advisory closed. No schema, no RLS, no edge-function changes. Part one of the three-way 5.16.1 split (5.16.1.0 tooling / 5.16.1.1 lint-to-zero + observations / 5.16.1.2 Supabase advisor).

### D1: Vite 5→8 stepped per-major in one sub-phase, not split into three squashes

The four hops (5→6→7→8) each landed as their own commit on the feature branch (auditable history) but fold into one 5.16.1.0 squash. Rationale: stepping per-major preserves regression-forensic clarity (a Lightning CSS crash at the 7→8 hop is unambiguously a Vite-8 thing, not smeared across three guides), while one squash keeps the deploy surface single. Isolating all of Vite from the lint/observation cleanup (5.16.1.1) means a Vite rollback unwinds only the upgrade.

### D2: CSS minifier pinned to esbuild instead of adopting Vite 8's Lightning CSS default (owner call)

Vite 8 switched the default CSS minifier from esbuild to Lightning CSS. Lightning CSS is stricter and hard-errors on empty-selector `!important` rules that Tailwind's JIT emits from false-positive candidates — it scans `!row` out of idiomatic JS negations like `!row.read` and generates spurious important-variants of our `@layer` component rules, some with no selector. esbuild's minifier silently dropped these across Vite 5/6/7, so they were invisible dead CSS in production. Owner's call (in-session): pin `build.cssMinify: 'esbuild'` now (one line, keeps CSS output byte-identical to pre-8 production, advisory still closes) and log the Tailwind artifact as a 5.16.1.1 carry-forward, rather than fixing the empty-selector generation inside a tooling phase. Once 5.16.1.1 closes the Tailwind artifact, the override drops and Lightning CSS becomes the default.

### D3: esbuild SSRF advisory closed by Vite 8's bundled esbuild, not by removing esbuild

The Phase 5.8 carry-forward (esbuild dev-only SSRF, affected esbuild ≤0.24.2) closes because Vite 8 ships esbuild 0.27.7 internally (deduped with `tsx`'s copy). esbuild is NOT gone from the tree — Rolldown + Oxc are the build engine, but esbuild 0.27.7 remains as the (now non-vulnerable) CSS-minify backend and a transitive of `tsx`. `npm audit` no longer flags it. Remaining audit findings (`qs` moderate transitive, `xlsx` high no-fix) pre-date this phase and are out of scope.

### D4: Node floor pinned to Vite 8's own range

`package.json` `engines.node` mirrors Vite 8's published floor verbatim (`^20.19.0 || >=22.12.0`); `.nvmrc` = `22` (latest LTS, simplest single value satisfying the floor); `netlify.toml` `[build.environment] NODE_VERSION = "22"`. Pinning all three prevents works-on-my-machine drift across Cowork / Code / Netlify. No Node bump was required of Jimmie (local Node 25.9.0 already clears the floor).

### D5: eslint excludes `supabase/functions/**` (Deno working-norm posture)

Edge functions run on Deno with a different working norm and shipping discipline; they stay outside the frontend lint contract. Adding `supabase/functions/**` to the eslint ignores narrows the baseline from 191 problems (165 errors / 26 warnings, full repo) to 30 (4 errors / 26 warnings, frontend-only) — the measurable number 5.16.1.1 burns to zero. The edge-function tree accounted for 161 of the 165 errors. A separate gated `lint:edge` script under Deno rules is an explicit 5.16.1.1+ option, out of scope here.

## Phase 5.16.0: Freelance access flatten + DB tier hardening (2026-05-28, complete)

Squash: folded into the Phase 5.16 consolidation squash (placeholder `<pending consolidation squash>`; deployed 2026-05-28). One migration (`20260610000000_phase_5_16_0_freelance_flatten_and_tier_hardening.sql`); 7 frontend files (1 deleted). Closes the Phase 5.11.0 data-leak audit finding (pending users hold a valid `authenticated` JWT and could hit raw PostgREST against `using(true)` HQ Core policies) while promoting freelance to functional equality with standard.

### D1: Freelance flattened to standard; the row-scoped contributor model was dropped

The original `phase-5-16-0-spec.md` draft scoped freelance as a row-scoped project-contributor tier (read/write only assigned projects, read-only CRM, via an `is_project_member()` helper). That model is **out**. Jimmie's call: freelance now equals standard for all permission purposes. The `freelance` enum value persists **only** as a visual badge so admins can identify freelance staff in the Users list. Rationale: the row-scoped model added a large RLS + helper + per-page-affordance surface for a distinction Mirror does not actually enforce day-to-day; flattening removes that complexity and ships the security hardening (the genuinely valuable half) without it. No `is_project_member()` helper was added.

### D2: `is_active_member()` is the new standing RLS predicate

Single SECURITY DEFINER STABLE helper: `permission_role::text <> 'pending' AND active = true` (`::text` keeps it enum-rebuild-safe per the `is_producer_or_admin` precedent; SECURITY DEFINER so it reads `public.users` inside an RLS predicate without recursion; REVOKE FROM PUBLIC + GRANT to authenticated/service_role). Every HQ Core policy previously `USING (true)` / `WITH CHECK (true)` was rewritten to `(select public.is_active_member())` (the 5.8.5 init-plan wrapping). Admin / standard / freelance behavior is unchanged at the DB layer (all satisfy the predicate); `pending` now 403s at the raw API. Admin-gated, self-scoped, and the credentials freelance-block policies were left untouched.

### D3: Account Logins carve-out survives the flatten

Freelance still cannot see Account Logins. Enforced at two layers, both unchanged by this phase: the `WikiPage` component-level `page_type === 'account_logins'` block, and the `credentials_*_non_freelance` RLS policies (`admin` + `standard` only). The flatten widened everything EXCEPT this deliberate carve-out.

### D4: `wiki_pages.visibility` CHECK collapsed (dropped `no_freelance`)

`visibility` is a `text` CHECK column, not an enum, so the collapse was a three-statement move: UPDATE the one `no_freelance` row (`account-logins`) to `all`, DROP CONSTRAINT, ADD CONSTRAINT with `('all','admin_only')`. Admin-curated per-page freelance-hiding goes away as a feature (it only ever hid Account Logins, which the component + credentials RLS already block). The editor's Visibility dropdown drops to Everyone / Admin Only.

### D5: `users_select` keeps an `OR id = auth.uid()` self-read clause (deviation from literal spec)

The spec listed `users` SELECT as a flat `is_active_member()` rewrite. That would have broken the pending flow: `useUserRole` + `ProtectedRoute` read the caller's own `users` row to resolve `isPending` / `isDeactivated` and drive the `/pending` redirect + deactivation sign-out. A bare `is_active_member()` gate returns null for a pending/deactivated user reading their own row, so the redirect never fires. Fix: `USING ((select public.is_active_member()) OR id = (select auth.uid()))`. Pending still cannot read the rest of the user directory; it can only read its own row. Caught by the migration-reviewer pass.

### D6: Three Bucket-3 SELECTs hardened despite the spec's "no change" label (deviation)

The spec put `activity_log`, `global_settings`, `mirror_holidays` in Bucket 3 ("already gated, no change"), but the live snapshot showed all three had `SELECT = true` (readable by pending via raw API). Leaving them would perpetuate the exact leak class 5.16.0 closes. Owner decision (confirmed in-session): harden all three to `is_active_member()`. Verified behavior-safe first — every reader is a member/admin surface (Home, Activity Feed, Calendar, admin Settings); no pending or unauthenticated path reads them.

### D7: `anthropic_call_log` stays admin-only (resolves the 5.15 D5 speculative note)

The 5.15 migration left a comment that 5.16.0 might broaden `anthropic_call_log` to `is_active_member()`. It was **not** broadened. Spend/cost data is sensitive and every consumer surface is already admin-gated, so widening would expose data with no UI consumer. `anthropic_call_log` + the `anthropic_spend_breakdown` RPC stay admin-only (Bucket 3, genuinely already gated).

### D8: No new Freelance chip on the Users list / profile (deviation)

Spec §6 #8/#9 asked for a separate neutral "Freelance" pill on TeamList + UserProfile alongside the tier label. Both surfaces already render "Freelance" as the tier pill, so a second pill would render "Freelance" twice. Owner chose "leave as-is, no new chip" — the existing tier pill already satisfies the "admins can identify freelance staff" goal. TeamList + UserProfile were not modified.

### D9: Scope corrections surfaced by the live snapshot

The spec's table lists were drafted from memory; the authoritative `pg_policies` snapshot corrected three things. (a) `public.vendors` policies are named `clients_*` (OID-preserved through the clients->organizations->vendors rename) and were missing from the spec's enumeration; added. (b) Only 3 `vs_*` tables exist (`vs_scouts`, `vs_candidate_venues`, `vs_venue_photos`); the spec's "8+" counted `vs_briefs`/`vs_pitch_decks`/`vs_sourcing_rounds`, which the 4.1 port dropped. (c) `wiki_images` is a storage bucket, not a table; the spec listed it in Bucket 1 in error. The `venue_photos` bucket has no `_select` policy to recreate (dropped in 5.8.5); only the 3 write policies were rewritten.

## Phase 5.15: Anthropic per-tool call-log infra + spend breakdown surface (2026-05-28, complete)

Squash SHA `1814867`. Per-phase narrative in `docs/v1-changelog.md` § Phase 5.15. 4 sub-phases collapsed (originally 5.15 / 5.15.1 / 5.15.2 / 5.15.3). Two migrations (`20260608000000_phase_5_15_anthropic_call_log.sql` + `20260609000000_phase_5_15_3_spend_breakdown_window.sql`); 11 edge function redeploys; 5 frontend files + design-system canon updates.

Decisions grouped thematically: infra (D1-D5), UX iteration (D6-D8), CSS canonicalization (D9-D10), window selector (D11-D16).

### D1: Storage shape — per-call rows in a table, not pre-aggregated buckets

Picked an append-only `public.anthropic_call_log` table (one row per successful `callClaude`) over the alternatives of (a) bucketed monthly aggregates on `global_settings` (cap at 5 columns, breakdown impossible), (b) a materialized rollup view (refresh complexity for marginal read speedup), or (c) attaching counters to existing tables (`vs_scouts.anthropic_spend_usd`, `ts_roles.anthropic_spend_usd`). Per-row keeps the raw token counts available for re-costing after pricing changes, supports future per-scout / per-role drilldown without schema work, and the breakdown RPC's hot path (one window of data, indexed by `(app, fn_name, created_at desc)`) is fast enough that pre-aggregation isn't worth the staleness tradeoff. 12-month prune via the existing monthly-reset cron keeps the table small without a separate maintenance job.

### D2: Cap-control consolidation onto HQ Admin Settings (cap-edit only)

HQ Admin Settings becomes the sole canonical home for the editable Anthropic spend cap. Pre-5.15, both TS Settings and VS Settings carried duplicate editable cap inputs writing the same `global_settings.anthropic_spend_cap_monthly_usd` column. Consolidating produces one editable surface (HQ Admin Settings) and two read-only spend displays (TS Settings shows TS-only + global spend; VS Settings shows VS-only + global spend). Avoids the "edit the cap from any of three places, all writing the same row" sprawl. The read-only **per-function breakdown** lives on all three Settings consumers as of this ship (D6 below) — the consolidation applies to the editable cap input only, not the read-only breakdown surface.

### D3: scout_id / role_id at the wrapper, not in caller-side metadata

`scout_id` + `role_id` ride the `callClaude` options object so every caller that knows them threads them through one place; pre-create flows (`ts-generate-scorecard`, `ts-refine-scorecard`) and venue-only contexts (`hq-generate-venue-about`) log null for both, which is fine. Both columns are nullable FKs with `ON DELETE SET NULL` so a deleted scout or role doesn't lose the cost record (which is what producers care about for spend retrospectives). Indexes on `scout_id` + `role_id` are partial (`WHERE ... IS NOT NULL`) because most rows have neither set.

### D4: Per-scout / per-role drilldown UI deferred

The schema captures `scout_id` + `role_id` per row, but the v1 breakdown surfaces only Tool / Calls / Total Spend / Avg per call. Per-scout drilldown (e.g., "how much did Claude cost this specific scout?") and per-role drilldown sit behind a "Drill into scout / role" button on the breakdown table that doesn't exist yet. Defer to a future phase that picks the right anchor surface (scout detail page or role detail page). The schema linkage is the load-bearing piece; the UI lift is straightforward when a producer asks for it.

### D5: Admin-only RLS for v1; 5.16 may rewrite

`anthropic_call_log` SELECT is admin-only via an inline `EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND permission_role = 'admin')` policy. The aggregation RPC is SECURITY DEFINER with an inline `public.is_admin()` gate, with EXECUTE granted to `authenticated` so the gate surfaces a clean `admin only` exception instead of a 403. Forward-compatible with 5.16.0's `is_active_member()` pass: the narrow policy stays narrow until that broader hardening rewrite either replaces it with the new helper or leaves it alone.

### D6: Per-function breakdown broadens to TS + VS Settings (app-filtered)

The initial cap-control consolidation (D2 above) put the breakdown table only on HQ Admin Settings. Smoke note surfaced the gap: producers working inside Talent Scout or Venue Scout wanted their own tool's per-function spend visible without bouncing to HQ. The breakdown broadens back to TS + VS Settings as a client-filtered view scoped to that one app (`<AnthropicSpendBreakdownTable appFilter="talent_scout" />`). Cap input stays HQ-only per D2; only the read-only breakdown surface broadens. Filter mechanism is intentionally client-side: the RPC returns the full pool unchanged, the component drops rows where `r.app !== appFilter` before render. Two RPC calls per TS / VS page load (parent summary + table fetch) is fine at Mirror's scale; introducing a shared `useAnthropicSpend` hook deferred.

### D7: HQ Admin Settings keeps the grouped full-pool view

When `appFilter` is omitted, the table renders a grouped view: HQ Core / Talent Scout / Venue Scout subheaders in fixed order, each with inline subtotal ("App Label · N calls · $X.XX total") and per-function rows below sorted by spend desc. Fixed order is locked even when a section is empty (empty groups render a "No calls this month" stub under the subheader) so producers always see the three sections regardless of month-to-month spend mix. Subheaders read better than a flat-sorted mix where TS, VS, and HQ rows would interleave by spend desc. Single table with `colSpan={4}` subheader rows + `Fragment` keys per group; no nested tables.

### D8: `SpendCapCard` rename deferred

VS Settings' `SpendCapCard` function name is misleading post-consolidation (no cap input lives there). Renaming to `AnthropicSpendCard` would touch one declaration + one JSX usage; deferred to keep the squash diff tight. One-line carry-over comment added at the function declaration so the next sweep notices. Carry-forward to a future cleanup phase (or fold into 5.16's codebase triage).

### D9: `.scout-list-tbl` → `.tbl-list` canonicalization

The list-table wrapper class shipped as `.scout-list-tbl` in Phase 5.12.14.3 / 5.13.2 alongside its first VS consumer (ScoutIndex). TS Index adopted it in 5.13, and this ship brought it to the HQ Anthropic spend breakdown surface — three consumers across all three app contexts. The name still implied a VS-only scope. Renamed globally to `.tbl-list` so the identifier signals the canon role ("list-table wrapper") rather than the original consumer. Six selector groups in `src/index.css` and three consumer `<div className="...">` references all flip in the same commit; comment block above the rule rewritten to describe the cross-cutting role. Future HQ Core list-page sweep (Projects / Tasks / Venues / Vendors / Clients / People) will adopt the wrapper without the prior name dissonance.

### D10: `.tbl-divider` global repaint to coral + white

Pre-ship `.tbl-divider td` rendered surface-alt + subtle-foreground 11px uppercase mono, mirroring the thead chrome. That contract worked when the tbody background was the canonical `.tbl` neutral, but `.tbl-list` paints tbody td with surface-alt — and the new HQ breakdown surface composes the two — so dividers blended into the body. Repainted globally: muted coral background (`hsl(var(--primary) / 0.3)`) + bold white text + coral-tinted top/bottom borders at the matching `0.3` alpha so borders blend with the coral fill. Keeps the 11px uppercase mono chrome; only color + bg shift. Single repaint covers every consumer: `<DataTable>`'s two-tier "Done · N hidden" footer (every HQ Core list) and `<AnthropicSpendBreakdownTable>`'s HQ / TS / VS section headers. Selector grew to a comma list (`.tbl-divider td, .tbl-list .tbl tbody tr.tbl-divider td`) so the repaint's specificity beats `.tbl-list .tbl tbody td` and wins inside the lifted-cells context. Final alpha 0.3 picked via in-commit smoke (tried 0.7 → 0.4 → 0.3).

### D11: Year window = calendar year

`window_kind='year'` snaps via `date_trunc('year', anchor)` to Jan 1 of the anchor's calendar year + adds one-year interval for the exclusive end. Rolling 12 months (e.g., May 2025 → May 2026) was the alternative; calendar year matches the fiscal lens admins think in ("year-to-date Anthropic spend") and pairs with the existing 12-month log retention via `ts-cron-monthly-spend-reset`. Multi-year compare deferred (log retention is one year so it's bounded; surfacing it would require a different RPC + UI).

### D12: Toggle scope = all three Settings consumers

The Month / Year segmented toggle ships on HQ Admin Settings, TS Settings, and VS Settings. Toggle state lives in each consumer (no shared global) and is passed to `<AnthropicSpendBreakdownTable>` via a `window?: 'month' | 'year'` prop. Each consumer derives its summary numbers from a parallel breakdown RPC call that takes the same `window_kind` — two RPC calls per page (parent summary sum + breakdown table fetch) keeps the summary and the table in sync without a shared cache. Toggle state does not persist across navigation; remount defaults to Month. Persistence deferred.

### D13: HQ Cap-card "Current Period Spend" comparison frame scales

Under Month, the spend display reads "$X.XX of $Y.XX cap" against the monthly cap. Under Year, it reads "$X.XX of $Y.XX annualized" where annualized = monthly cap × 12. The cap input field itself stays monthly (the underlying `global_settings.anthropic_spend_cap_monthly_usd` column is monthly); only the comparison reference frame scales with the toggle. Over-cap warning fires against the relevant reference per window. Email-alert copy ("Alert email already sent for this month") was left as-is under Year; the alert wiring is monthly so the copy stays accurate, and rewriting it for the annualized case would be a layering misstep. Reconsider if/when a year-mode alert lands.

### D14: Segmented `.viewswitch` UI primitive

Two text-only buttons ("Month", "Year") rendered directly with the canonical `.viewswitch` class. No icons (the breakdown context already says "Per-tool breakdown" + window labels above). `.on` class drives active state; `aria-selected` + `role="tab"` for a11y. Did not adopt `<ViewSwitch>` (`src/components/data/ViewSwitch.tsx`) because that component is hardcoded to the HQ list-page view-kind enum (list / board / timeline / calendar). Lifting it to be generic was deferred. No new CSS.

### D15: Drop `anthropic_spend_current_month_usd` from Settings reads

The pre-window-selector reads on TS Settings + VS Settings + HQ Cap card pulled `global_settings.anthropic_spend_current_month_usd` to display "Current Period Spend." That column is the cap-alert tracker — written incrementally by `_shared/anthropic.ts trackSpendAndAlert` and reset monthly — but it's monthly-only by definition. To support Year mode, all three consumers derive `currentSpend` from the breakdown RPC pool (sum all returned rows). The column stays on `global_settings` because the cap-alert system still uses it; the read just shifts to the RPC.

### D16: RPC signature: explicit DROP before CREATE

The window-selector ship's second migration drops the old `anthropic_spend_breakdown(month_iso text)` signature explicitly via `DROP FUNCTION IF EXISTS` before creating the new two-arg form. `CREATE OR REPLACE` with a different signature creates a sibling function alongside the old one; both would coexist and PostgREST's named-argument resolution would be ambiguous. No callers of the old signature exist post-ship in the codebase (every Settings consumer + the breakdown component migrate to the new signature in the same window-selector ship), so the DROP is safe.

## Phase 5.14: Venue photo persistence (2026-05-28, complete)

Squash SHA `4e67f12`. Per-phase narrative in `docs/v1-changelog.md` § Phase 5.14. Two edge functions touched: `vs-generate-deck` + `vs-research-venues`. No migration.

All three `vs-research-venues` hq_pool INSERT paths covered (`loadHqVenuesIntoPool` deterministic-keep, Phase B seed-then-drop, `rescueHqPoolFitVetoedVenues`). Pre-populate pattern is uniform: fresh INSERT captures candidate id via `.select("id").maybeSingle()`; photos queued in `photoSeedCandidates`; `Promise.allSettled` fires `seedHqPhotosToVs` per candidate after the loop. Telemetry unified with `path=load/seed_then_drop/rescue` qualifier on all three `[hqPoolPhotoSeed]` log lines.

### D1: Use existing `venues.photos text[]` column

Column already exists (`text[] NOT NULL DEFAULT '{}'`, created in `20260506061457_initial_schema.sql` line 374). No migration needed. HQ photo surface is backend-only for v1; no per-photo metadata needed on the HQ side. `text[]` naturally extends to N > 4 slots later without schema changes.

### D2: Use existing `venue_photos` storage bucket

Bucket already created in `20260506061457_initial_schema.sql` line 908. Public bucket (CDN URLs bypass RLS). Write gated to `is_producer_or_admin()` for SDK callers; service-role (edge functions) bypasses. No new bucket needed.

### D3: Flat-keyed storage at `<venue_id>/photo_<slot>.<ext>`

Latest deck's photos always overwrite at the same deterministic path. Simple and predictable. Per-scout photo history already preserved in `vs_venue_photos` bucket if ever needed. Extension changes handled by deleting old paths first (Step A) then uploading new paths.

### D4: 4 slots locked for v1

Matches deck template (img_1..img_4), matches `vs_venue_photos` CHECK BETWEEN 1 AND 4. `photos text[]` naturally extends to N later without migration.

### D5: No backfill of pre-5.14 venue photos

Existing venues stay photo-empty until a producer generates a deck involving them. Natural fill through normal workflow. Avoids Drive scope complexity.

### D6: Pre-populate at seed time in `vs-research-venues`

Copy HQ photos to `vs_venue_photos` when `loadHqVenuesIntoPool` (and seed-then-drop) creates hq_pool candidates. Everything downstream (Review UI, PhotoUploadModal, deck generation) works unchanged. Best-effort: copy failure = empty slots. Producer can still upload/replace per slot in Review.

### D7: No HQ frontend changes in 5.14

No VenueDetail photo display, no VenueEdit photo management. Photos are storage-layer persistence only. Frontend surface deferred to Phase 5.15+.

## Phase 5.13: Talent Scout review (2026-05-27, complete)

Squash SHA `2393840`. 7 sub-phases plus project doc clean-up, collapsed into one commit. Per-phase narrative in `docs/v1-changelog.md` § Phase 5.13.

### `.savebar` deleted; `.actionbar` is the single sticky-bar class

`.savebar` was a duplicate of `.actionbar` with built-in flex + padding. Removed and folded sub-rules (`.dirty`, `.btn`, `.btn-tertiary`) into `.actionbar`. `StickySaveBar` renders `.actionbar` with an inner flex wrapper. One sticky-bar class HQ-wide eliminates the "which class do I use?" question and guarantees padding parity across all three surfaces (HQ Core, VS, TS).

### `TIER_META` consolidated to a single definition in `scorecard.ts`

Two parallel definitions (CandidateDetail had `token` + `label`; scorecard.ts had `color` + `label` + `subtitle`) became one. `scorecard.ts` is now the source of truth, with `color` renamed to `token` using canonical `.p-{token}` values. NewRoleScorecard + RoleSettings tier-badge spans converted from raw Tailwind to `pill pill-sm` + `meta.token`. Three consumers, one definition, all on design-system tokens.

## Phase 5.12: Venue Scout review (2026-05-23 to 2026-05-27, complete)

Squash SHA `ed81c38`. 28 sub-phases collapsed into one commit. Per-sub-phase narrative in `docs/v1-changelog.md` § Phase 5.12. 10 migrations + 9 edge functions touched cumulatively.

### Schema + migrations

#### `dedupe_meta` jsonb on `vs_candidate_venues`

Captures dedupe-ladder scoring breakdown on FRESH `pushVenuesToHq` merges only (not pre-linked, not hq_pool, not no-match INSERTs). Nullable, no backfill: chrome is informational. UI consumer shipped then deprecated, but the jsonb shape + write path stay so a future UI re-intro is fresh implementation, not archaeology.

#### `brief_data` shape lock (5 keys flip to `string[]`)

Five keys (objectives, target_audience, target_neighborhoods, vibe_aesthetic, ideal_features) flip from string to string[]. Migration normalizes legacy strings to single-element arrays + resets overview hash. New `sanitizeTagArray` helper backs three sanitizers. `hashAsStringArray` coerces single strings as defense-in-depth.

#### Neighborhoods nested in cities

New `public.neighborhoods` lookup parent-scoped under cities. Unique `(city_id, LOWER(name))`. Consumer columns stay text per the cities precedent (lookup is canonical for picker UI but not joined at query). `useLookup` extended with `PARENT_COLUMN_BY_TABLE` map. City-change clears dependent neighborhoods.

#### `venue_types` DB-driven with case-insensitive uniqueness

Canonical types read at runtime via shared `useLookup` cache (frontend) and per-request `getVenueTypesCanonicalSet` fetch (5 edge functions). Migration consolidates case-variants via insert-then-delete on `venue_venue_types` (avoids PK violations the UPDATE pattern would hit), drops case-sensitive UNIQUE for a `LOWER(name)` expression index (cities pattern). Schema descriptions stay static for prompt-cache stability per `feedback_tool_choice_collapse`; the live list rides in the per-call user message. `TYPE_STYLES` palette stays keyed on 9 legacy names; producer-added types render via `TYPE_FALLBACK_STYLE`.

#### `city_aliases` + `vs_candidate_venues.source` widening

`public.city_aliases` with `LOWER(alias)` unique index. `vs-parse-brief` resolves via 6-step alias-first ladder, auto-creating novel cities with state-stripped value so lookup never accumulates "City, ST" strings. Separately, `vs_candidate_venues.source` CHECK expanded to include `'hq_pool'`; new `SOURCE_PRIORITY`: manual < sheet < hq_pool < research. New "Venues DB" SourcePill state.

#### Two new advisory-lock kickoff RPCs

`vs_research_try_acquire_kickoff` + `vs_deck_try_acquire_kickoff`. SECURITY DEFINER, service_role only. See **Kickoff RPC pattern** below.

#### `vs_scouts.shortlist_sync` trigger retired

Trigger dropped. HQ Venues match-or-insert moved to top of `vs-generate-deck`, gated by confirmation modal. Trigger fired on every transient shortlist toggle; the deck-generate gate is the only producer-confirmed write-to-HQ moment. `venues.about_venue` only written when linked row's value is blank, preserving producer edits.

### Edge function patterns

#### Kickoff RPC pattern: advisory lock + grace window

Long-running pipelines that mutate state on entry are vulnerable to a check-then-write race (double-click, retry without backoff). RPC closes it atomically: `pg_try_advisory_xact_lock` under per-function namespace + same-transaction read-and-write of kickoff timestamp + clear `pipeline_error`. Grace window MUST exceed function's `WORK_TIMEOUT_MS` so a refresh during in-flight work doesn't acquire a second kickoff. Hardened to `WORK_TIMEOUT_MS + 60_000` across all three VS functions.

#### CAS guards on final UPDATE

`Promise.race([work, timeout])` rejects on timeout but losing work() is NOT cancelled: a slow Claude call can resolve later and overwrite the failure stamp with success. Every async pipeline's final success UPDATE must CAS on `current_step=<expected>` AND `pipeline_error IS NULL`. Kickoff RPC clears pipeline_error at acquisition; once writeFailure stamps non-null, late-success UPDATE no-ops cleanly.

#### Fit-rescue pattern for HQ pool venues

Pre-Phase-B rescue sends brief + each fit-vetoed or drop-below-threshold HQ city-pool venue's fields + about_venue to Claude via forced `submit_fit_evaluation`. Keep-verdicts INSERT as `source='hq_pool'`. Hard physical vetoes excluded; null about_venue skipped (no rescue signal). Cap 20 venues. Best-effort: Claude failure falls back to deterministic pool; research never blocks on rescue.

#### `vs-research-single-venue`: three in-function auth gates

VS RLS is open-authenticated, so identity verification at the edge layer needs explicit gates. Pattern: `venue.scout_id === scout_id` (probe-defense), `venue.source ∈ {manual, hq_pool}`, scout state ∈ forward-only set. Both 404 on miss to avoid probe disclosure.

#### `vs-regenerate-venue-overview`: synchronous single-venue Pass 2

Mirrors vs-compile-summaries Pass 2 byte-for-byte. Two auth gates: `venue.scout_id === scout_id` + `scout.current_step === 'deck_prep'`. Frontend passes producer notes explicitly so edit-then-regenerate doesn't race the debounce. Why a new function vs single-venue mode of vs-compile-summaries: latter is async + CAS-guarded + kickoff-locked; bypassing means explaining everywhere, honoring means producer waits ~30s for an unneeded kickoff window. New function is cheaper.

#### Non-mutating-prereq reorder in `vs-generate-deck`

`pushVenuesToHq` previously ran before env-var check + template copy, so a missing-env failure left HQ state mutated for a deck producer was told wasn't generated. Fix: env-var check pulled up immediately after venues load + before push. Push is idempotent on `linked_venue_id` so re-generate runs cleanly. Moving push after Slides success is logged as carry-forward.

#### `vs-delete-scout`: per-bucket storage cleanup

Synchronous, `verify_jwt = true`, service-role, no extra gate (single scout_id, no cross-entity surface). Order: enumerate paths → DB DELETE (cascades) → per-bucket batched `storage.remove([...])`. Partial cleanup degrades to orphans rather than rolling back; the scout is already gone. HQ venues (`ON DELETE SET NULL`) and Drive deck files stay by design.

### Prompt audit

#### `key_features` as evergreen tags, not narrative

Shift from address-anchored sentences to 2-10 short evergreen tags (1-4 words). Three surfaces in lockstep: FILL_TOOL schema, Phase B TOOL schema, ABOUT_VENUE_SYSTEM input-fields label sync. New `sanitizeTagShape` helper (drops non-strings, digits, > 4 words, > 35 chars, dupes) composes with `stripPlaceholders` at 5 write sites. SYSTEM bodies stay byte-for-byte per `feedback_tool_choice_collapse`. Post-impl: Features matrix column swaps textarea for `TagInput` pills; manual + HQ-picker rows default `shortlisted: true` for auto-research; `pushVenuesToHq` write-when-blank extends to features + total_sq_ft + capacity + website_url.

#### `ABOUT_VENUE_SYSTEM` cap widen to 100-150 words

Two-step widen (90-110 → 90-120 → 100-150). Smoke showed quality of longer outputs was right; tighter cap was wrong. 6 example outputs stay byte-for-byte (voice anchors; variance is itself signal that paragraph length adapts). New tag-priority guidance: favor most appealing/distinctive tags when expanding more would push above cap.

#### Retail bias soften + search-scope flexibility

Five edits across Phase B SYSTEM, Phase B userMsg, `FILL_SYSTEM`, and `requirementLines` (both call sites). Brief's venue-type preference allows 1-2 high-aligning outliers; neighborhood-strict toggle produces sharper guidance on both sides. Always-soften, no new flag.

#### Event Overview voice tuning

`vs-generate-brief-overview SYSTEM_PROMPT` rewrites to a four-block `<voice>` + `<must_not>` + `<rules>` + `<examples>` structure modeled on `ABOUT_VENUE_SYSTEM`. Hierarchy inverts from "stay faithful to facts" to "creative extrapolation is welcome," with hard-fact lockdown moved to `<must_not>` as the binding constraint. User-message reshapes from flat dump into three labeled blocks (FACTS, CONTEXT, NOTES). The most-felt producer change of the audit.

#### ParsedPreview selective-apply checkboxes

Per-row checkbox so producer can opt out of any parsed field before applying. Default checked. Post-impl: ParsedPreview hides Event overview row (downstream owns final value); multi-option dates via three optional array fields with server-side `collapseDateOptions` enforcing mutual exclusion.

### UX + chrome

#### `.tbl` matrix decouple

R7 attempted to make matrix the HQ-wide table canon via `.tbl --matrix` composition. `.tbl` base rules carry specificity (0,2,2)+ beating every matching Tailwind utility (0,1,1) on the matrix's bespoke primitives. Decision: detach matrix tables from `.tbl` entirely. HQ Core consumers remain on original canon. Future HQ-wide canon flip would rewrite `.tbl` to match matrix primitives then re-couple.

#### Back-crumb relocation to TopBar

21 pages each mounted their own `.crumb` with inconsistent styling. Decision: render once globally in TopBar's left zone via `useReferrerCrumb` + canonical-parent route table. Predicate hides crumb when href is "/" so root-tier pages don't show a useless "Back to HQ". Hidden below md. BriefReport stage-aware override: hook fires a supabase query for `current_step` only on that one route. VS pages bypass sessionStorage and always use canonical-parent table (VS is linear, not a graph). HQ Core keeps three-layer resolution.

#### Lookup Lists shared component

Extracted HQ Settings' inline table-of-lists into `LookupListsCard` with `lookups` filter prop. HQ Settings (7 entries) + VS Settings (3 entries) render same chrome. Neighborhoods joins via expansion-content branching with `inline?: boolean` prop. Adding a new lookup HQ-wide is one filter entry.

#### Shared VS primitives + intake restructure

`ScoutPageHeader` 3-zone primitive (empty-left | stepper centered | gear icon right) consumed by 8 in-scout pages. `VSPageField` canonical primitive (12px coral mono uppercase label) replaces 4 local Field helpers; `ui/Field.tsx` stays as matrix-cell variant. Intake restructure: BriefEvent + BriefVenue land full-width with `.card` canon; vibe + aesthetic migrated from Event to Venue. `sq_ft_max` retired with `sq_ft_min` legacy fallback.

#### Honest loading progress + DateRangePicker

Replace timed-fake `setInterval` step bumps with server-emitted `brief_data.progress_step`. Backend writes 4 progress markers in each of three VS pipelines; frontend reads via Realtime. Timed fakes mislead when real operation runs faster or slower than the timer. DateRangePicker wraps `react-day-picker` + `date-fns`; storage unchanged (formatted strings into text columns).

#### Matrix shared 7-column layout

Both Sourcing + Shortlist render through same `VenueMatrixRow`; per-page differences collapse to col-1 label/handler + page-level source-of-truth. Columns: Shortlist/Pitch+Source | Venue | Location | Website | Features | Recommendations | Considerations. ~1440px. Notes/Feedback column dropped.

#### Final Review + Deck Prep consolidation

DeckPrep wins the rename slot; FinalReview deletes. Generate fires from Deck Prep (load-bearing surface). Producer flow drops standalone `review_selects` step: Shortlist Continue flips current_step directly to `'compiling'`. Enum value stays for back-compat; `stepToRoute("review_selects")` resolves to `/review` so legacy scouts forward without backfill. Per-venue card layout wins (job is content tuning, not row scanning). Per-card body extracts to `ReviewCard.tsx`.

### Cut + retired

#### Phase 5.12.8 cut: Brief client-logo web search

Cut 2026-05-24: producer value low, busy-work shape; upcoming HQ-alignment styling pass on brief surface is likely to drop client logo display entirely.

### Carry-forwards

- HQ-wide `.tbl` canon flip (rewrite to match matrix primitives, recouple).
- Phase 5.14 venue photo persistence.
- VS research-accuracy audit (hallucinations, tag verifiability, name/neighborhood canonicalization, URL accuracy).
- Phase 5.15 Anthropic per-tool call-log infra.
- `vs-generate-deck` neighborhood auto-add at deck-push time.
- Review-as-cards canon (producer-locked).
- System Prompts editor (deferred sub-phase).
- BriefReport stage-aware crumb scope (revisit if smoke flags).

---

## Phase 5.11: UX/design-system audit + structural consistency (2026-05-23)

Frontend-only structural pass after parallel audits. Goal: chrome convergence and shared primitives, not redesign.

### Detail-page editing patterns stay dual-path

Detail pages keep inline edits for high-frequency fields; pencil button stays the escape hatch to the full edit form for broader edits, grouped fields, deletes, relationship rewrites. Dual path is intentional. ProjectDetail's card title stays "Status Notes" (not generic "Notes") because the editor is the successor to the old status-notes field.

### FilterBar `allowIsNot` remains opt-in

Default is "is" only. Surfaces that need a negative lifecycle filter (Tasks, Deliverables) opt in. New surfaces should not expose "is not" unless a real workflow needs it.

### VendorEdit Tags dropped; Capabilities is the vendor tag surface

`vendors.tags` stays in DB but VendorEdit no longer exposes it. Producers manage classification through Capabilities (managed-lookup, consistent on vendor surfaces). Client/Person/Vendor detail tags remain hidden (loaded but not rendered); decision was to document divergence rather than reintroduce. Project Tags + Venue Features stay visible (active managed-lookup fields).

### PersonDetail patterns

Title-row pill routes to edit because type derives from affiliation state; changing inline needs purpose-built reassignment UI that clears + sets relationship atomically. Until that exists, pill sends to edit form. Venue-contact people get a sibling Associated Venues card with `combo-as-link`, hidden in-trigger chips, bullet-separated coral venue links.

### ProjectDetail Vendors sidebar exception

Standalone relationship cards normally use headbar `combo-as-link`, but Vendors keeps its add-Popover because discoverability is better there and sidebar carries vendor-specific detail. Documented exception, not precedent.

### Venue Slide stays a header action

VenueDetail keeps Venue Slide in title-row action cluster, VenueEdit keeps Master Venue Deck Slide card. Don't move into a generic Links card unless Venue gains enough distinct link types.

## Phase 5.10: `venues.about_venue` rename + AI About-paragraph generator (2026-05-21)

Standalone follow-on opening Phase 5.10. Rename + generator + buttons ship in one squash with one Netlify deploy.

### Rename `venues.notes` to `venues.about_venue`

Column has always been the deck-copy body on Surface 09; `notes` was misleading because HQ already has the polymorphic `notes_log` table. `RENAME COLUMN` is OID-preserving (indexes, FKs, triggers, views, realtime publication auto-track). `bulk_import_commit_venues` rebased; importer commit payload + CSV template header changed in lockstep.

### Breaking-rename coordination

A column rename breaks the deployed frontend's `venues.notes` SELECTs (local dev hits live Supabase). Migration apply + edge-function deploy + Netlify frontend deploy MUST land as one coordinated ship. Held until push approval rather than applied out-of-band (the usual "additive migrations are safe to apply early" guidance doesn't cover breaking changes).

### HQ generator is TOOL-LESS with its own evergreen prompt

Initial cut lifted VS `vs-compile-summaries` Pass 2's `write_overview` tool + `OVERVIEW_SYSTEM` verbatim. On review we recognized the venue overview is one reusable artifact in two places, and VS's brief-tailoring ("specific to the brief", "serves the specific event") is wrong for an evergreen About paragraph. Decision: HQ gets its own `ABOUT_VENUE_SYSTEM` (evergreen, brief-less, voice + web-research rules baked in) and runs tool-less. Tool-less eliminates the `feedback_tool_choice_collapse` failure class outright (no forced tool to collapse). Legacy `OVERVIEW_TOOL` + `OVERVIEW_SYSTEM` stay frozen for VS; VS convergence deferred to Phase 5.12.

### `'hq'` Claude spend bucket, first consumer

`hq-generate-venue-about` is the first `callClaude('hq', ...)` caller in HQ; `KEY_BY_APP` already routes `'hq'` to `ANTHROPIC_API_KEY_HQ`.

### web_search included; `tool_choice: auto`

Includes `web_search_20250305` with `max_uses=2` so Claude can pull concrete detail when the venue row is sparse, gated by strict verify-from-authoritative-sources rules. Auto mode lets the model decide whether to search; with no custom tool present it replies in plain text. Empty reply gets a deterministic "name in city" stub.

### Generate AND Regenerate both ship; button always renders

Empty `about_venue` is "Generate" (no confirm); populated is "Regenerate" with AlertDialog confirm (overwrite warning). Applies to all populated venues including hand-typed paragraphs. Buttons on both VenueDetail and VenueEdit. On VenueEdit the button disables while form is dirty so generator never runs against stale-saved values.

## Phase 5.9: Bulk Import (2026-05-21)

The Projects → Vendors → Venues importer trio, plus follow-on enhancements (vendor nationwide flag, vendor general_email, vendor contact-People creation, venues importer additions). All on the 5.9.1 bulk-import primitive.

### SECURITY DEFINER RPC is the source of atomicity

PostgREST can't run a multi-statement transaction that rolls back together (memory `feedback_postgrest_no_multi_statement_tx`). Chained `supabase.from().insert()` would leave partial writes on mid-chain failure. So the whole commit lives in one `bulk_import_commit_<entity>(payload jsonb)` plpgsql function. Any `RAISE` rolls everything back. Convention: each entity gets its own RPC. `EntityHandler.commit()` is a thin wrapper. The RPC owns `bulk_import_sessions` + activity_log writes and signals via a returned `session_id`; the edge function skips its own session inserts when present (otherwise double-inserts).

### Auth pattern matches `promote_outlook_to_project`

RPC re-checks `permission_role='admin'` (raises 42501) as defense in depth on top of the route gate + edge function re-check. `actor_id` passed in payload because edge invokes via service-role (so `auth.uid()` is NULL inside). Per-cell parse coercion server-side; browser passes strings.

### EntityConfig owns resolution + payload shape

5.9.1 invented the registry; 5.9.2 locks three optional hooks: `buildUnresolved(parsed)`, `buildDedupe(rows)`, `buildCommitPayload(gridRows, mappings, decisions)`. Plus optional `validateRows`. Host stays generic; per-entity branches never grow.

### Projects: people roster not importable

Account Lead / Designer / Team Members dropped. Set retroactively on edit page after import. Roster columns added friction (every row needed a resolvable pre-provisioned staff email; account_lead was required) for data quick to attach by hand. No DB constraint forces a project to have an Account Lead.

### Projects: dedupe-update replaces venue roster, never merges

CSV is authoritative on update path: RPC UPDATEs columns and DELETEs + re-INSERTs `project_venues`. People roster joins deliberately left untouched (importer doesn't manage them; re-import must not wipe what a producer set by hand).

### Vendors: subcategory parent uses plain text field, not typeahead

Subcategory only makes sense under a parent. MapStep resolves each distinct value once but carries no per-row parent context, so can't auto-populate a dependent's inline-create form. Two options: sophisticated queued-aware typeahead, or plain `parent_category` text. Locked plain text for v1. Small redundancy, clean architecture. RPC matches case-insensitively against queued then existing categories; unresolvable raises 23503.

### Vendors: `preferred` is enum cell coerced to bool

Rather than add a `boolean` ColumnKind for one column, importer reuses enum cell with `enumValues: ['true', 'false']`. RPC coerces via `lower(value) = 'true'`. Real boolean cell deferred.

### Vendors: Capabilities auto-create mirrors Project category/city lookup

`vendors.capabilities` is `text[]` of names; lookup table backs autocomplete only. Cell is free-text multi-value with datalist suggestions; RPC lazily auto-creates novel rows. NOT a MapStep ref kind.

### Vendors: dedupe key + ON CONFLICT correction

Dedupe key is `lower(name) + lower(coalesce(city, ''))` (vendors have no natural unique key). Spec wrote `ON CONFLICT ON CONSTRAINT vendor_categories_name_unique_idx` but that's a `LOWER(name)` expression index, not a `pg_constraint` row; clause raises "constraint does not exist". Implementation uses `ON CONFLICT (lower(name)) DO UPDATE SET name = EXCLUDED.name RETURNING id`. `vendor_subcategories` uses `ON CONFLICT (parent_category_id, name)` which IS a real UNIQUE constraint.

### Vendor nationwide flag: bool column + generic filter hook, not sentinel city

Some vendors work nationwide. Sentinel city or tag wouldn't work because the city filter matches a row's city string against the chip; a "Brooklyn" chip never matches "National". Real enabler is filter-logic change. Chosen: `vendors.nationwide bool NOT NULL DEFAULT false`. Filter behavior in generic `applyFilters` param `fieldMatchAll?: Record<string, (row) => boolean>` (per-field "always satisfies" predicate). VendorsList passes `{ city: (row) => row.nationwide }`. Green "National" pill on list. Same pass added VendorEdit "Preferred" checkbox, closing a pre-existing gap. First-class bool is typo-proof and the filter override is cleaner than sentinel-tag.

### Vendor general_email: company-level email, distinct from contact_email

Discovered during 5.9.3 smoke: a vendor's detail-page "Email" was actually the primary contact's. Considered a company "main phone" but dropped (only email lands; `contact_phone` stays the contact's). VendorDetail relabeled "Email"/"Phone" to "Contact Email"/"Contact Phone" and added "General Email" + "Website" under company-level group.

### Vendor importer creates contact People

Vendor importer wrote `vendors.contact_*` as plain text but never created a `people` row, so imported vendors had no Primary Contact (picker resolves a real vendor-affiliated `people` row). Reversed original spec's "no people-roster handling" exclusion (that was about project staff). Per-row commit creates a `people` row with `affiliation_type='Vendor'`. Dedupe scoped to same vendor, not global: `people_affiliation_type_mutex_check` plus one-org-per-person makes relinking by email unsafe. Rows with no contact_name skip person creation.

### Venues: `venue_types` is two-step ref (lookup-create + join-write)

Unlike vendor's FK columns, a venue carries many types through `venue_venue_types`. Resolution is two-step: queued types created first (building `_queued:N` → uuid map), then per row each resolved id INSERTs into join `ON CONFLICT DO NOTHING`. On dedupe-update the join is REPLACED (importer owns it, matching `project_venues` precedent). Queued-create uses case-insensitive existence probe before INSERT, not `ON CONFLICT (lower(name))`: `venue_types.name` is a real UNIQUE constraint (case-sensitive), not an expression index. `venue_types` has NO `created_by`; stamp omitted.

### Venues: `exclusive_vendor_ids` is NOT importable

First cut shipped it; Jimmie clarified it should only be set on manual VenueEdit. Removed in follow-up. Load-bearing reason RPC had to change, not just frontend: prior RPC wrote `exclusive_vendor_ids = v_excl_vendors` on dedupe-update, so a stopped-sending importer would have wiped manually-curated values on every re-import.

### Venues: contact-People link through `venue_contact_people` JOIN

Vendor's contact surfaces because VendorDetail reads `people.vendor_id` directly. Venues are many-to-many; entire app reads through the join; `people.venue_id` is a dead legacy column. RPC creates a `people` row with `affiliation_type='Venue'` AND inserts join row. Venue-scoped dedupe matches THROUGH the join, NAME-first then email (reverses vendor's email-first): venue contacts more often share a venue-aliased inbox than a name. Join is additive on update (never wiped), in deliberate contrast to `venue_venue_types` which IS replaced.

### Venues: Event Day Rate seeds append-only `venue_rate_history`

Event Day Rate isn't a venue column; lives in `venue_rate_history` (most-recent-wins on detail). Importer appends one `event_day` row per imported venue with `effective_from = current_date`. Insert only when amount changed: RPC reads current most-recent and inserts only if `IS DISTINCT FROM`. Re-import with same value is a no-op (prevents clutter). `prod_day` not importable (little historical data). Whole dollars.

### Venues: `general_email` only; no VenueDetail label rename

Mirrors 5.9.3.2 vendor decision. Nullable text; re-import with empty cell on update path clears the field. Unlike the vendor pass, NO "Email"/"Phone" rename on VenueDetail: venues surface contacts ONLY through `venue_contact_people` sidebar; VenueDetail/VenueEdit never expose `venues.contact_*` as fields, so nothing to rename. Venue Details card reordered + General Email always shown (paired with Website; hiding when empty would break two-column pairing).

## Phase 5.8: HQ v1 release + security audit + cleanup (2026-05-19)

### Open-authenticated RLS posture (HQ Core baseline)

Supabase advisor's full scan emitted 54 `rls_policy_always_true` warnings across 5 categories. The open-authenticated posture is intentional and matches HQ Core's threat model (single trusted Google-OAuth-gated tenant). Recording here so future scans can be cross-checked, not mistaken for drift. Categories: lookup tables (cross-team reference data, writes gated on `is_admin()`), top-level domain tables (open SELECT/INSERT/UPDATE; DELETE either admin-only or open-authenticated, audit log captures every delete), join tables (inherit parent openness), file/history tables (read-everyone, write-gated), VS tables (collaborative agency-wide workflow).

The 2 `authenticated_security_definer_function_executable` warnings on the credentials RPCs are an intentional carve-out: SECURITY DEFINER to access `pgsodium.key`, gated on the same predicate as RLS, no alternative non-RPC path because the client never sees the encrypted column.

### RLS helper EXECUTE carve-out

`is_admin()`, `is_producer_or_admin()`, `current_user_role()` MUST stay EXECUTE-callable by `authenticated`. They're invoked inside RLS predicates on ts_roles, ts_candidates, ts_evaluations, ts_pull_rounds, ts_final_reviews, vs_scouts, tier-gated DELETE on users/clients/projects/venues/venue_types, and users UPDATE WITH CHECK. The 5.8.5 migration REVOKE'd from PUBLIC without re-GRANTing on the assumption that SQL-function inlining would skip the permission check; that was wrong (SECURITY DEFINER blocks inlining, every RLS caller needs EXECUTE), and production TS open-roles went empty within seconds. Hotfix re-GRANTs to `authenticated`. These 3 helpers join `promote_outlook_to_project(uuid)` and 3 credentials RPCs as 7 permanent advisor hits. Spec-drafting lesson preserved in `feedback_revoke_execute_check_rls_callers.md`: before REVOKE'ing EXECUTE on any SECURITY DEFINER function, grep for callers.

### React Query partial adoption stays as-is

The 2026-05-18 audit's F042 claimed `QueryClient` was instantiated but `useQuery` was never called. Live grep contradicted: three files use it for ~13 call sites. Every other page (~25) is on the legacy `useState + useEffect` pattern. Two options: rip out, or convert remaining. Both valid; both out of scope for a security pass. F042 closed as "audit was wrong."

### Auth: HIBP password leak check N/A

Advisor flags `auth_leaked_password_protection`. HQ Core doesn't store passwords; auth is Google Workspace OAuth restricted to `@mirrornyc.com`. The warning is moot and will remain in scan output indefinitely.

### `rls_auto_enable` defensive trigger (do not drop)

`public.rls_auto_enable()` is wired to `ensure_rls` event trigger. Iterates newly-created `public.*` tables and runs `ALTER TABLE ENABLE ROW LEVEL SECURITY`. SECURITY DEFINER, fail-safe. Load-bearing safety net for the open-authenticated baseline: any future migration that creates a public table without enabling RLS is caught automatically. The 5.8.5 spec misread the advisor framing as Phase 3 cruft; the DROP attempt failed with a dependency error. Do not drop.

### `tmp_5_8_5_probe` pgsodium key (accept-risk)

A probe key remains in `pgsodium.valid_key` from a spec-deviation migration rewrite. Never used in any encrypt call. pgsodium restricts DELETE on `pgsodium.key` to internal role by design (append-only). Functionally inert. Accept-risk: leave in place.

## Phase 5.7: HQ Core UI overhaul (2026-05-18)

### Wiki images: private bucket + 1-year signed URLs

Drafted spec offered public bucket as the simple path. Locked PRIVATE to keep wiki-image confidentiality consistent with `wiki_pages` RLS (admin write, authenticated read). SELECT lets any authenticated user fetch the object so signed URLs work. TTL tradeoff: signed URLs are bearer-token-style with a Supabase max of 1 year. After ~365 days an unedited page's `<img>` tags 403. Acceptable for v1; if it bites, carry-forward is render-time URL-swap (store `data-storage-path`, generate fresh URL on mount).

### Browser-side resize cap = 1200px

Canvas resize ceiling at 1200px max width. Big enough that a typical wiki diagram renders crisp on a 13" laptop, small enough that a 4K original drops to ~200KB. JPEG quality 0.85.

### Diff-on-save cleanup (no orphan-image sweep)

On save, diff old body HTML against new and `storage.remove()` any paths that left the document. On page-delete sweep every embedded path. On editor-cancel sweep this-session uploads via `makeSessionUploadTracker()` ref. Avoids needing a periodic cleanup cron. Tradeoff: a hard browser refresh mid-edit can't reliably fire async storage deletes from `beforeunload`, so a small orphan window exists. If it grows, future carry-forward is a nightly job that diffs storage against extracted paths.

### `TiptapImage` alias

`@tiptap/extension-image`'s default export is named `Image`, colliding with the global `Image` constructor used in `resizeImage()` (`new Image()` for pixel dimensions). Aliased the import.

### Lookup Lists merged into single card + inline editor under its own row

Pre-5.7 Settings split Project Categories + Cities into their own pair above "Other Lookup Lists". Merged into one "Lookup Lists" card holding all six with inline tags editor. First cut rendered expanded `<tr>` after the loop so editor opened at bottom of `<tbody>` regardless of row clicked; refactored each row + conditional expanded into a `<Fragment>` so editor renders immediately below.

### Integrations card collapsed to header-only Coming Soon

Smoke ask: drop the three disabled IntegrationRows, reduce to one-line "Integrations, Coming Soon" header. Shipping disabled toggles advertises features that don't work and invites "why is my toggle stuck?". Notification wiring is future-phase scope.

## Phase 5.5: Notifications + Activity Feed + Search (2026-05-16)

### `notifications-dispatch` is internal-only (no user-JWT path)

First instinct was `requireInternalOrUserAuth`. Security audit caught it: any signed-in Standard or Freelance user could POST with a crafted `recipient_user_ids` to spoof in-app notifications + trigger Slack DMs to admins. The function reads with service role, so authorization is replaced by internal-secret gate at entry. All legitimate callers (notifications_dispatch_writer trigger, handle_new_user, hq-cron-*) already send `x-internal-secret`. No browser path needs direct dispatch access.

### `user_pending` in-app row stays inline, dispatch only handles email + Slack

`handle_new_user` writes the durable `notifications` row for every active admin BEFORE invoking dispatch. To avoid duplicate, dispatch special-cases `event_type='user_pending'` and skips the in-app insert. The in-app signal is the most important guarantee; putting it inline in the trigger means it lands even if dispatch 500s. No unique-constraint backstop on notifications, so the simpler "skip in dispatch" is robust without a schema change.

### `auth.uid()` for trigger actor, fallback to `created_by`

`notifications_dispatch_writer` reads `auth.uid()` for `actor_id` so dispatch can exclude self-notification. RLS-scoped client carries the JWT, resolving to the acting user. Service-role writes (cron, edge function chain) return null. For `task_assigned` COALESCE uses `NEW.created_by` as fallback. For `task_blocked` and `project_status_changed` we let `actor_id` be null when no JWT (better to notify everyone than skip silently).

### CSS reuse + cron naming

Project Detail's activity sidebar shipped `.activity-row` + `.actdot` in 5.1/5.2; Activity Feed reuses verbatim. Only `.notif` was net-new. Cron naming: `hq-cron-*` not `cron-*` (three daily crons cross multiple tables so no single-module prefix fits); `hq-cron-*` keeps `<module>-cron-<purpose>` convention spirit. DataTable's centralized `<div className="empty">` retained; swapping for shared `<EmptyState>` would require threading an icon prop through 7+ sites for zero visual change.

## Phase 5.4: Wiki + Account Logins + Users + Settings (2026-05-16)

Spec: `OUTPUTS/phase-5-4-spec.md`. Four surfaces lifted from Wireframe Surfaces 12, 17, 18, 20. One squash, with two follow-on feedback rounds.

### ID-swap on pre-provisioned users

Team Add needs to insert a `public.users` row for a teammate who hasn't signed in. Shipped FK `users.id REFERENCES auth.users(id)` blocked that. Three options considered: (A) drop FK, keep id-swap on first sign-in; (B) add `auth_user_id` column (every RLS policy comparing against `auth.uid()` would need updating); (C) skip pre-provisioning. Locked A. Tradeoff: hard delete in auth.users no longer cascades; Mirror rarely hard-deletes auth users. Migration amends `handle_new_user` to perform id-swap (idempotent: matching id is no-op stamp; matching email with different id triggers swap; no match triggers fresh-pending insert + admin notification).

### `department_tags` dropped in favor of `departments` lookup + single FK

Phase 5.1 shipped `users.department_tags text[]` with four hardcoded values. Wireframe Surface 12 surfaces ONE department from a richer list. The four old values were never surfaced in any current UI. Drop column + CHECK; add `department_id uuid REFERENCES departments(id) ON DELETE SET NULL`. Lookup table seeds with five wireframe-matching values. Inline-add via existing `useLookup` hook (extended to know about departments).

### Credentials stored plaintext-at-rest

The `credentials` table stores `password text NOT NULL` plaintext. Intentional: access control is RLS-enforced (Freelance blocked, admins write, standard + admin read), Supabase provides encryption at rest at the storage layer, the reveal-and-copy UX is convenience pattern not security boundary, the data is operational team credentials (shipping accounts, vendor portals) not user secrets. Application-level encryption rejected (client-side keys = fresh problem each session; server-side endpoint = latency + RLS duplication). Matches industry baseline for internal team password vault.

### Wiki `page_type` enum + special pages

`wiki_pages.page_type` ∈ `prose | team_directory | vendors_glance | account_logins`. Prose stores markdown (later HTML) in `body`. The three special types render hardcoded components and ignore body. Special pages are seeded by migration and can't be created or deleted from UI (Edit hides Delete when not prose). Keeps special-page surface tightly coupled to the migration so Calendar/Logins/Vendors pages can rely on their slugs existing.

### Wiki accessible to Freelance (except Account Logins)

`/wiki` and `/wiki/:slug` use `<ProtectedRoute>` (all tiers including Freelance). Operational docs are useful for freelance contractors. Account Logins is the only exclusion: page row carries `visibility = 'no_freelance'` (filtered from nav), component shows access-restricted state if direct nav, underlying `credentials` RLS rejects the SELECT.

### `mirror_holidays` replaces hardcoded constant

`MIRROR_HOLIDAYS` array (shipped Phase 5.3) replaced with a table + `useMirrorHolidays()` hook. Migration seeds with previous values exactly so Calendar behavior is unchanged on deploy. Settings exposes CRUD editor so admins can add 2027+ holidays without a code change.

### GRANT fixes carried in this migration

`GRANT INSERT ON users TO authenticated` (admin pre-provisioning; RLS still gates to admin), `GRANT DELETE ON cities TO authenticated` (admin-only DELETE RLS was unreachable), `GRANT DELETE ON project_categories TO authenticated`. Same posture fix as Phase 5.2 did for `vendor_capabilities`.

### Feedback round amendments (folded into squash)

- **Wiki editor switched from markdown to TipTap WYSIWYG.** Storage shifted from markdown to HTML. 11 seeded prose pages rewritten. Renderer changed to `dangerouslySetInnerHTML` (admin-authored trusted content). `react-markdown` dep stays in package.json unreferenced.
- **Wiki visibility gained `admin_only`.** Widened CHECK. Nav filters; component-level gate blocks direct slug nav.
- **Vendors at a Glance → Preferred Vendors.** Slug + title updated. Component file not renamed (still keyed to `page_type = 'vendors_glance'` enum).
- **`/team` route renamed to `/users`.** `/team*` redirects so pre-feedback notification links still land. `handle_new_user` rewritten to emit `/users`. Page file paths stayed at `src/pages/team/*` to limit churn.
- **Calendar holidays render yellow.** `.cal-ev.hol` uses amber `--warn` token replacing prior gray.
- **Account Logins writes open to Standard.** Original spec gated writes to admin only. Intent was writes available to everyone except Freelance, matching SELECT posture.
- **Preferred Vendors curated via `vendors.preferred` flag.** Migration adds bool + partial index. `VendorsGlanceEmbed` filters to `preferred = true`. Admin gets "Manage Preferred List" dialog with search + scrollable list; save diffs against initial-set and only writes flipped rows.

## Phase 5.3: Calendar + Outlook (2026-05-16)

Spec: `OUTPUTS/phase-5-3-spec.md`. Surfaces 15 (unified Calendar) + 16 (admin-only Outlook).

### Outlook Confidence color override

Locked wireframe defined `.ol-rad` / `.ol-like` / `.ol-conf` / `.ol-comp` with colors that disagree with the locked mapping (`OUTPUTS/phase-5-locked-decisions-2026-05-15.md`). Mapping is source of truth: On Radar → amber, Likely → cyan, Confirmed → green, Complete → gray. CSS block lifted to `src/index.css` flips the four rules in place so class names match semantic meaning. Alternative (lift verbatim, let JS assign "wrong" class for right color) rejected: "Confirmed gets `.ol-conf` which renders amber" is cognitive dissonance.

### Shared toggle drives Calendar visibility, not Outlook page visibility

`outlook_entries.shared_with_team` is the gate for whether an entry surfaces on the unified Calendar for non-admins. Outlook page itself is admin-only via `<AdminRoute>`. Standard / freelance only path to an Outlook entry is the shared banner on the Calendar, which is non-clickable. Admins see same banner clickable, routing to `/outlook?year=YYYY&month=MM#entry=<uuid>`. Locked non-clickable over hide-from-standard so producers can see "team has a planning event that week" without drilling into admin-only page.

### Promote vs Unlink vs Delete

Three distinct actions: Promote to Project (RPC creates `projects` row from entry, sets `linked_project_id`), Unlink Project (clears `linked_project_id` only; project stays), Delete entry (removes `outlook_entries`; linked project stays unlinked; FK is `ON DELETE SET NULL`). Intentionally separate so producer can detach a speculative entry from a real project without nuking either.

### Mirror Holidays seeded as static constant

`MIRROR_HOLIDAYS` is hardcoded in `src/lib/calendar/holidays.ts`, sourced from official 2026 PDF. Multi-day windows expanded into one entry per non-weekend closed day. 5.4 will ship the CRUD editor against a `mirror_holidays` table; static approach is intentional 5.3 scope (a CRUD editor without a Settings page is premature).

### Per-user Calendar visibility persists via `saved_views`

Four toggles persist via single implicit `saved_views` row (`entity_type='calendar'`, `is_default=true`). One row per user; no naming UI. Migration extends CHECK to include `'calendar'`. `useCalendarVisibility` handles lazy-INSERT + debounced UPDATE. `?source=projects`/`?source=tasks` first-visit defaults only apply when no saved row exists. Filter chips stay component-local (same convention as `<FilterBar />`); Calendar doesn't ship a saved-views dropdown in 5.3.

## Phase 5.2: Projects/Tasks/Deliverables + Organizations/People/Venues + clients-vendors split (2026-05-16)

Spec: `OUTPUTS/phase-5-2-spec.md`. Shipped across 5.2.1 (HQ Core databases + cross-cutting components + rail amendment), 5.2.2 (entity trio + schema reshapes), 5.2.1-revision (wireframe-fidelity rebuild).

### Project + Task status enum reshape

Both Postgres enums rebuilt to match locked canonical labels rather than label-mapping in UI. `project_status` went from 14 legacy to 14 locked values: 6 dropped (Awaiting FB, Awaiting Files, Awaiting Approval, Event Live, Proof Out, In Review), 6 added (Approved, Install, Removal, Queued, Awaiting Feedback, Cancelled). Catch-all backfills: Awaiting Files → In Progress; Proof Out → In Production; In Review → In Progress. `task_status` went lowercase to mixed case; `tasks_completed_at_set` trigger CREATE OR REPLACE'd in same migration so the literal `'done'` comparison flipped to `'Done'`. `taskStatusLabel()` is gone.

### Deliverables table

New 4-value `deliverable_status` enum (Upcoming, In Progress, Complete, Skipped). Skipped renders strikethrough + opacity-60. Multi-assignee via `assigned_user_ids uuid[]` (matches wireframe first-name stack) rather than join table. `completed_at` set by parallel trigger to tasks. RLS open-authenticated. Added to `supabase_realtime` for Board drag-drop.

### `activity_log_writer` extended to handle DELETE

Pre-5.2.1 the function initialized `action_val` + `payload_val` inside INSERT/UPDATE branches only; a DELETE invocation would leave both NULL and violate `activity_log.action NOT NULL`. Existing triggers fired only on INSERT OR UPDATE so the gap was invisible. The 5.2.1 deliverables trigger fires on INSERT OR UPDATE OR DELETE, so function CREATE OR REPLACE'd (same OID, triggers keep resolving) with DELETE branch: `action_val := 'deleted'`, `payload_val := jsonb_build_object('old', to_jsonb(OLD))`. DELETE logs `actor_id = auth.uid()` which is NULL for server-context / cascade-delete; actor_id is nullable, and server-initiated delete is correctly attributed to null actor.

### `saved_views` per-user table

Persisted per-user filter/sort/view-kind snapshots. Per-user RLS scoped to `user_id = auth.uid()` (only HQ Core table that doesn't follow shared open-authenticated posture; saved views are personal not team state). `is_default` per `(user_id, entity_type)` enforced in app via transactional "clear then set" upsert (`createSavedView`); no DB unique partial index because a multi-row write would have to dodge constraint mid-flight.

### Tasks priority + blocked_by

`tasks.priority text NOT NULL DEFAULT 'Normal' CHECK IN (Urgent, High, Normal, Low)` + `tasks.blocked_by uuid[] DEFAULT '{}'` with GIN index. uuid[] beats join table for simplicity; Postgres can't FK-enforce array elements so app validates entries before write.

### Rail amendment: single Tools group + tool-app variant

Tools (Standard + Admin) + admin-only items collapsed into one ordered list with per-item `adminOnly?: boolean`. Locked order: Wiki, Talent Scout, Venue Scout, Team, Outlook, Settings. Tool-app variant detected via `pathname.startsWith('/talent-scout')|...('/venue-scout')` swaps Primary group for [HQ Home, Activity Feed]. Route-based not state-based.

### Clients → Organizations rename

`ALTER TABLE clients RENAME TO organizations` + `client_id → organization_id` + index rename. RLS/GRANTs/triggers carry through by OID; policy identifiers stay `clients_*` (Postgres doesn't auto-rename) but access posture preserved. Rows backfill as `type='Client'`. Shipped `notes` renamed to `legacy_notes`; Internal Notes flips to polymorphic `notes_log`. `org_type` enum: Client/Vendor/Internal (Venue Owner intentionally dropped).

### People table + internal_rating

External humans only in `people`; internal staff stay in `public.users`. Multi-affiliation via `affiliations person_affiliation[]` (GIN-indexed). `created_by NOT NULL` with ON DELETE RESTRICT matches deliverables posture. `organizations.internal_rating int CHECK (BETWEEN 0 AND 5)` is vendor-only; admin-write-only RLS gating deferred to 5.4.

### Venues: multi-select type + new columns + rate history

Single `venue_type_id` FK dropped in favor of `venue_venue_types` join. New columns: city, venue_slide_url, total_sq_ft, exclusive_vendors_org_ids. New `venue_rate_history` append-only table (SELECT + INSERT only) drives "Event Day Rate $X as of <date>" via most-recent row per `(venue_id, rate_kind)`. `notes_log` CHECK widened to include 'venue' so shared `<InternalNotesEditor />` serves Venue detail.

### `projects` schema additions

`projects.notes` renamed to `status_notes`; new `client_notes text` for parallel Client Notes card. Surface 04 list columns + Surface 07 detail: `job_number`, `category`, `city`, `tags`, `budget`. Budget is planning reference, NOT invoice amount; never renders on pipeline-summary surfaces.

### CSS lift block + data component DOM rewrites (revision)

Original 5.2.1 shipped parallel Tailwind utility groups instead of consuming wireframe canonical class names (`.input`, `.viewswitch`, `.fchip`, `.tbl`, `.bcol`, `.tl`, `.calgrid`, `.kv`, `.savebar`, `.stat`, `.pill p-<token>`). Result looked close-but-off. Revision rebuilds visual layer byte-for-byte. UNPREFIXED so components author against wireframe markup. Coexists with 5.1 chrome (`.hq-*`). Components rewritten: `<ViewSwitch />` to icon-segmented, `<FilterBar />` to chip pattern with `.andor` connector, `<DataTable />` to `.tbl-wrap > .tbl[.tbl--flat]` with `flat?: boolean` prop, `<BoardView />` to two layouts via `layout` prop, `<TimelineView />` to 8-month gantt, `<CalendarMonthView />` to `.calgrid`.

### Deliverables Board: one column per project

Build notes Surface 14 says "one column per project (horizontal scroll)." Original 5.2.1 shipped rows-per-project, which code-reviewer flagged. Revision flips to `<BoardView layout="horizontal">` grouped by `project_id`. Drag-drop intentionally NOT wired (moving between columns would imply re-parenting, heavier intent than drag-drop conveys).

## Phase 4 cutover + port plan locked decisions

Venue Scout port plan doc was deleted in the 5.8.3 audit. The six locked decisions confirmed 2026-05-11 and cutover sequence rationale captured here as canonical record.

### Port plan locked decisions

- **Single-round sourcing per scout.** One scout, one sourcing flow. No `vs_sourcing_rounds` table. Re-research via Start Over.
- **Brief inline on `vs_scouts`.** Named columns for structured fields, `brief_data jsonb` for flexible additional fields. Simpler queries, matches state-machine model.
- **`EdgeRuntime.waitUntil` + Realtime for Researching/Compiling/Generating.** All three loading pages subscribe to `vs_scouts.current_step` via Realtime instead of awaiting synchronously. Edge functions return scout_id immediately. Requires `vs_scouts` in supabase_realtime with REPLICA IDENTITY FULL. Only place the port diverges from VS Pro; consistent with HQ's `ts-final-review` pattern.
- **`current_step` state machine as canonical workflow state.** 9 values lifted from VS Pro: sheet_prompt, sheet_upload, researching, sourcing_report, shortlist, review_selects, compiling, deck_prep, completed. Revision Intake added `brief` as a 10th value. `stepToRoute()` helper drives every page's continue logic.
- **Deck history as `vs_scouts.generated_decks` jsonb array.** No separate `vs_pitch_decks` table. Deck history is small (1-3 versions per scout), access pattern is "all decks for this scout," no query against deck fields. jsonb embeds cleanly.
- **RLS open to all authenticated users.** `FOR ALL TO authenticated USING (true) WITH CHECK (true)` on every `vs_*` table. Collaborative agency-wide workflow, not personal data.

### Cutover sequence (2026-05-13)

Main hard-reset to `vs-port-fresh` HEAD via `--force-with-lease`. Cherry-picked TS Final Review commits (verified byte-equal via `git show --stat`). Considered TS-wizard Stepper-migration but dropped (imported from a file introduced by the failed 4.3.1 squash being discarded; carrying file standalone was the alternative; chose zero-contamination path). Verification check is `git show --stat <new-sha>` vs `<source-sha>`, NOT the naive `git log` empty check (impossible by design since cherry-picks produce new SHAs). Post-cutover: `vs-start-sourcing` orphan deleted; the 4.1-port DROP TABLE statements were already applied to production ledger.

## Phase 4 Revision: Intake (3-step brief stepper)

Follow-on correcting Phase 4.3-port + 4.9-port surfaces. Rebuilt single-page Brief into 3-step stepper (Event → Venue → Review) and gathered venue-side fields the sourcing prompt needs.

### New `brief` current_step + Generated Decks section

Migration adds `brief` to CHECK constraint and flips new-row default from `sheet_prompt` to `brief`. Step 3 Confirm flips to `sheet_prompt`. Existing scouts on `sheet_prompt` treated as post-intake; `/brief` redirect sends them to the report. Step 3 renders Generated Decks (newest-first, "Open in Google Slides" per entry, hidden when empty). `vs_scouts.generated_decks` already persists every field; no schema change.

### `city` is required

Step 2 Submit disabled until city is non-empty. Downstream sourcing needs the city; old single-page Brief left it optional.

### `briefForm.ts` strips 16 form-backed keys

`fromScout` pulls form-backed jsonb into dedicated fields and keeps non-form keys (`uploaded_files`, `*_started_at` flags, legacy `notes`) in passthrough; `toUpdate` rebuilds. Round-trips cleanly. Retired `notes` key NOT stripped (no form field) so `toUpdate` preserves on existing scouts.

### Cross-step form state lives in a module store

`briefIntakeStore.ts` (same pattern as TS `wizardStore.ts`), keyed by scoutId. Step 1's Continue persists before navigating, but Step 2's Back must preserve form state in memory so a producer who edits Step 2, clicks Back, then Continue doesn't lose edits.

### Event Overview is generated with deterministic stub fallback

`vs-generate-brief-overview` fires on first arrival when `event_overview` is empty; re-invokable via Regenerate. On Claude failure writes deterministic stub so producer always lands on non-empty editable overview. Report-card editing uses explicit Save/Cancel because editor types are mixed and blur doesn't map cleanly.

### Pass 3: Event Overview generation moves to Submit Brief, hash-gated

Pass 1/2 auto-fired from a first-render `useEffect` when `event_overview` was empty. Two failure modes: (1) a producer who edited AI-parsed objectives then reached report via Brief chip never got regen because report only fired on empty; (2) report entry could burn a Claude call on every fresh mount. Rule: generate on Submit Brief, regenerate only when brief fields that drive overview changed.

Hash-gated regen via `computeOverviewSourceHash` (16-char SHA-256 prefix over 15 overview-driving fields, arrays sorted, empty-to-null normalized), recomputed identically server-side. Submit invokes only when overview is empty, stored hash missing, or stored != fresh. Why content hash not dirty flag: a boolean flag would need every brief-field write path to remember to set it and would drift; content hash is derived state that can't drift. The 15-field set matches exactly what the prompt consumes; hash inputs and prompt inputs move in lockstep. `BriefReport` dropped auto-fire `useEffect`; empty-state "Generate overview" button is manual fallback.

### `overview_source_hash` is `brief_data` passthrough, not hoisted

Machine-written metadata with no producer-facing form field, same shape as `*_started_at` flags. Rides in passthrough untouched by `fromScout` / `toUpdate`.

## Phase 4.10.6-port (URL acquisition fallbacks + deck flow polish)

### URL extraction fallback layered onto Claude's tool output

Phase B-sourced venues landed with `website_url=NULL` even when URLs were in `web_search_tool_result` blocks. Root cause: SYSTEM tells Claude not to use listing-database URLs, so Claude conservatively returned null even when usable URLs were visible. Two-stage fix as post-emission layers per `feedback_tool_choice_collapse`: (1) `extractWebSearchResults` walks response content for `{url, title}`; (2) `findVenueWebsite` runs a fresh focused Claude call per venue. Phase A + Pass 1 use cheaper `findBestSearchResultUrl` token-overlap heuristic (already venue-scoped per-row).

### Schema tightening + new FILL_TOOL fields

Tightened `submit_research.name` description to forbid descriptive suffixes ("Vacant Ground-Floor Retail - 10250 Santa Monica Blvd") with concrete BAD examples. Added `address` + `neighborhood` to FILL_TOOL (Phase A wasn't filling for sheet rows where producer left them blank). Patch guards only fill when existing value is null/empty so producer-entered values stay authoritative.

### Post-deck-generation flow + atomic regenerate reset

Open just-generated deck's `edit_url` in new tab via `window.open(_blank, noopener noreferrer)`, then navigate back to /deck/prep. Producer can immediately review AND has the matrix to regenerate/tweak. `handledTerminalRef` guards duplicate deliveries; `initialDeckCountRef` snapshot prevents regenerate from re-opening prior deck. Regenerate frontend reset was a read-then-write on `brief_data` with TOCTOU. Replaced with `reset_scout_for_deck_regenerate` RPC that does `brief_data - 'deck_generation_started_at'` atomically + `current_step='deck_prep'` + clear failure. SECURITY INVOKER.

### `updateSlidesPosition` per-slide moves

Slides API rejected single request with all duplicates: "should be in presentation order, no duplicates." Parameter requires `slideObjectIds` to match current order; it relocates a contiguous already-ordered block, doesn't reorder. Fixed by emitting one request per slide (single-element list is trivially in order). Slides processes batchUpdate sequentially; cumulative = canonical interleaved layout.

### Slide 2 ALL CAPS via scoped pre-pass

Slide 2 needs uppercase but other front-matter slides keep original casing. Scoped `replaceAllText` with `pageObjectIds: [slide2Id]` at head of globalReqs with uppercased values. Runs BEFORE case-preserving global pass; once slide 2's tokens are replaced, global pass can't find them there but still touches other slides.

### `vs-generate-deck` success path CAS guard

Two parallel successful invocations would both append to `generated_decks` with TOCTOU on `freshExisting` re-read. Success UPDATE now uses `.eq("current_step", "deck_prep")` so only first-to-complete wins. (Duplicate-invocation race in vs-research-venues acknowledged as carry-forward debt; eventually landed in 5.12 kickoff RPC.)

## Phase 4.10.5-port (AI surface stabilization)

### Model + web_search pivot: `claude-sonnet-4-6` + `web_search_20250305`

Smoke 2026-05-13 surfaced `server_tool_uses=0` across every Phase A + Phase B call on prior `4-5 + web_search_20250305`. Anthropic docs confirm newer `web_search_20260209` lists 4.6, Opus 4.6+, and Mythos; 4.5 isn't on the list. Pivoting to 4.6 restored invocation. Settled on OLDER `web_search_20250305` with NEW model after smoke showed newer dynamic-filter tool was billing 80k+ tokens per call (each web_search runs a code_execution sandbox internally and bills cumulative context across rounds). Simpler 20250305 with 4.6 invokes reliably AND keeps per-turn bloat bounded.

### `pause_turn` continuation in `callClaude`

Server-tool loop can return `stop_reason=pause_turn` when a long-running turn hits internal pause. Caller expected to send another request with prior assistant content appended; Claude continues. Without this, callers emitting a custom tool after multi-step web_search saw "no structured output" because tool_use block hadn't emitted. `callClaude` wraps a continuation loop. Capped at `MAX_PAUSE_CONTINUATIONS = 1` to keep latency bounded under app-level WORK_TIMEOUT_MS.

### `writeFailure` CAS guards prevent failure-overwrites-success

Two parallel invocations: first succeeds, second hits different code path and fails (was writing `status=failed + pipeline_error`, overwriting success). All three AI functions now CAS on `.eq("current_step", <expected_pre_success_step>)` on failure UPDATE. Failure no-ops when another invocation has advanced past pre-success step.

### Timeout sizing for Supabase Pro

Edge Function wall clock is plan-level (150s Free, 400s Pro), NOT settable via config.toml. After Pro upgrade: `WORK_TIMEOUT_MS = 360_000` (40s buffer under cap so writeFailure UPDATE lands before platform kill), `IN_FLIGHT_GRACE_MS = 360_000` (matched), Phase B `web_search max_uses = 4`, Phase A + Pass 1 `max_uses = 2`, `MAX_PAUSE_CONTINUATIONS = 1`.

### Trim `brief_data` JSON dump from Claude user messages

`Brief: ${JSON.stringify(scout.brief_data ?? {})}` dumped entire jsonb into every call including internal state flags. Pure noise to the model + inflated input tokens. Replaced with selective field extraction in three call sites. ~30-70% input token reduction.

### Placeholder string sanitizer

After tightening FILL_TOOL schema to require key_features / recommendations / considerations with minItems, Claude started filling arrays with literal `<UNKNOWN>` / `TBD` / `N/A` / `None` / `TODO` tokens (satisfying schema structurally while signaling "I don't know"). Two-layer fix: schema-description layer (primary per `feedback_tool_choice_collapse`) explicitly forbids placeholders with concrete offender list; post-emission `isPlaceholderString` + `stripPlaceholders` (strip whitespace + punctuation, lowercase, compare against set). 32-char length cap so real short observations don't accidentally match. If cleaned array is empty post-strip, skip the write so row keeps null state.

### Drop forced `tool_choice` on Phase A

Smoke showed Phase A `fill_venue` calls collapsing to out=94-115 minimal payloads under forced tool_choice. Same pattern as Phase B (4.10.3 retrospective). Changed to `{ type: "auto" }`. FILL_SYSTEM still says "fill structured fields" (strong directive); auto mode lets Claude use web_search freely before committing to the tool with real findings.

## Phase 4.10.4-port (pre-cutover smoke polish)

### Rank hidden in UI; column stays in DB

Producer doesn't trust the 0-100 number; source pill + sort tier convey relevant grouping. Hide from matrix but keep DB column + tool emission + patch-write paths. Reversible. With rank no longer visible, secondary sort flipped to `name.localeCompare` with `sensitivity: base` + `numeric: true`.

### Photo upload column removed from Shortlist

Photos are deck-prep concern. Column added affordance noise + made matrix wider. Review keeps the full photo grid. VS Pro kept both surfaces; HQ collapses to one.

### Notes/Feedback editor added to Review

VS Pro never surfaced `vs_candidate_venues.notes` for producer edit on Review. Added per-row textarea bound via debounceSave. Already factored into venue_overview prompt as `Producer notes: ${v.notes ?? "(none)"}` so producer's last-minute context shapes Pass 2 without landing on deck. Coral descriptor makes the contract explicit.

### Venue Overview prompt tuned via schema descriptions; OVERVIEW_SYSTEM untouched

Per `feedback_tool_choice_collapse`, system prompts stay frozen. Tuning levers: tool description, field description, maxLength. Swapped "5-8 sentences" to "3-4 sentences, ~80 words"; embedded positive examples from reference set. maxLength is soft signal; next lever is dropping further OR more examples, NOT editing SYSTEM.

## Phase 4.10.3-port (URL validation + AI surface consolidation + 3-tier sort + pipeline_error rename)

### AI surface consolidation: sheet enrichment moves into vs-research-venues

Smoke surfaced structural collapse: forced `tool_choice` + server-side web_search caused Claude to emit empty tool calls (out=113-139, server_tool_uses=0) on every per-row sheet enrichment AND vs-research-venues' submit_research (out=2304-2610 but server_tool_uses=0, returning training-knowledge venues with null URLs).

Locked Path B: consolidate AI venue work into vs-research-venues. vs-parse-sheet becomes parse-only (sub-second). vs-research-venues runs two phases inside `EdgeRuntime.waitUntil`: Phase A (parallel per-row enrich with patch guards) + Phase B (existing submit_research sourcing). Both kick off inside `work()`; Phase A awaits its loop, Phase B awaits Claude + INSERT, then function awaits Phase A before final state flip. vs-compile-summaries Pass 1 unchanged as backstop. Per-row enrichment no longer synchronous parse-blocker. SheetUpload's "Enriching N/M" UI dropped (no work at upload time now). One Claude surface for AI venue work, one web_search budget, one validation layer.

### `research_error` → `pipeline_error` column rename

Added at 4.5-port for vs-research-venues failures. 4.7.2-port (compile) and 4.8.2-port (deck) reused the column without renaming. Name has been misleading since 4.7.2; rename aligns with actual usage as single AI-pipeline error channel. Plain `ALTER RENAME COLUMN` preserves values. Two migrations: column rename + `CREATE OR REPLACE FUNCTION start_over_scout` to clear new name. Cross-cutting rename touches 3 edge functions + 4 page files, all in same squash so build stays green.

### URL HEAD validation (post-emission gate)

Smoke surfaced URL fabrication: Claude returns LoopNet/Crexi listing URLs with invented path segments that 4xx or soft-404 to homepage. `sanitizeWebsiteUrl` catches search pages + bare-homepage but not fabricated URLs matching syntax. New `_shared/urlValidation.ts` wraps with HEAD-request check + redirect-host + redirect-path comparison. 4xx rejects; 5xx + network errors keeps (transient); host mismatch rejects (soft 404); final path significantly shorter than request path rejects (listing-gone redirect). 5s timeout. Parallel via Promise.all inside vs-research-venues (~2-3s additional). Memory rule `feedback_tool_choice_collapse`: AI output quality lives on schema descriptions + post-emission validation.

### Schema tuning for Recommendations + Considerations + website_url

Bullets too long. Added per-array description (2-4 short observations, 10-15 words), per-item description with concrete examples, `maxLength: 150` recs / `maxLength: 200` considerations. Soft signal but Claude generally honors. website_url description updated to "verbatim URL from web search result. Do NOT fabricate" (positive-only redirect against verbatim-from-search lever; no forbidden URL list). Memory rule reaffirmed: no SYSTEM edits.

### 3-tier source priority sort

Carry-forward from 4.10.2-port 2-tier. New `SOURCE_PRIORITY` constant in `src/lib/venue-scout/format.ts` (single source of truth shared by SourcingReport + Shortlist): manual → sheet → research. Within each tier rank desc with nulls last. DeckPrep stays on producer-controlled dnd-kit order.

### venue_type inline editing UX (popover with checkboxes)

4.10.2 collapsed manual-row input into shared `VenueIdentityStack` and producer's path to set venue_type disappeared. Per port-plan locked "all rows editable except recs/considerations": click type-pills cell → popover with 8 canonical types as toggleable checkboxes; caller serializes to `${types.join(" / ")}` or null. New `TypeTogglePopover` primitive.

### VS storage policy reconciliation (open-authenticated, match table RLS)

Pre-4.10.3 buckets gated `is_producer_or_admin()` while vs_* table RLS is open-authenticated. Member-tier could read/write tables but couldn't upload files. Relaxed storage to authenticated; matches table RLS posture. `docs/auth-model.md` updated to reflect "members can use Venue Scout end-to-end." `vs_venue_photos` collapsed from 4 split policies to single FOR ALL.

## Phase 4.10.2-port (matrix UX overhaul)

### Alignment column removed; `EditableField` + `SourcePill`

Alignment column took ~200px for signal producers don't act on; rank conveys the same in less space. `derived_attrs` jsonb persists (deck may consume it). `EditableField` generalized from name-only contenteditable with `name|address|neighborhood` variants; `EditableTextarea` added for DeckPrep's `venue_overview`. `SourcePill` palette: sheet→"Uploaded" (amber), research→"Sourced" (muted), manual→"Manual" (electric blue, matches TS ReferralPill). NOT rendered on DeckPrep.

### Manual venues pin to TOP; Features editable on ALL rows

VS Pro sorted manual to BOTTOM. Producer call: manual rows are the ones added by hand and most wants to verify; top mirrors attention order. Features uses `<EditableTextarea>` with comma/semicolon/pipe/newline split-and-trim; manual rows no longer have special branch. Recs + Considerations stay AI-only per producer ("should always be generated by AI"). Visual asymmetry IS the affordance signal.

## Phase 4.10.1-port (sheet upload AI enrichment)

### Synchronous, not waitUntil; parallel-chunked at CHUNK_SIZE = 5

vs-parse-sheet does parse + insert + AI enrichment in single call. SheetUpload awaits full response. Producer's mental model is "drop sheet → wait → ready." Chunks of 5 with Promise.all, sequential across chunks: ~15-20s for 15-venue sheet (well under Edge cap). Per-row failures tolerated; compile-summaries Pass 1 catches orphans at pitch time. `derived_attrs` filled later (compile-summaries Pass 1 condition extended to fire for `source='sheet' AND derived_attrs IS EMPTY`). `FILL_TOOL` + `FILL_SYSTEM` + `buildFillUserMsg` extracted to `_shared/venueFill.ts` as single source of truth (both parse-sheet and compile-summaries Pass 1 use the same shape).

## Phase 4.9-port (Scout Settings + full ErrorState + per-scout chrome)

### Settings page is HQ-from-scratch; `start_over_scout` is an RPC

VS Pro has no Settings analog. Port plan directs HQ-from-scratch: rename + project link + Start Over in one Settings surface via gear icon (same arch decision as 4.3-port Brief). `start_over_scout` is a single transactional RPC reset replacing three sequential client-side writes. SECURITY INVOKER. Start Over keeps `generated_decks` (preserves audit trail). Per-scout chrome (`ScoutSettingsLink` + `ScoutStepThroughNav`) imports into 8 pages; loading screens excluded by design. Storage objects orphan after Start Over DELETEs; future cron sweep handles cleanup.

## Phase 4.8.3-port (deck-output correctness hotfix)

### Slide-index mismatch fix

VS Pro's generate-deck was written against a template with 5 front-matter slides. 4.8.2-port lifted verbatim per port-fidelity. Mirror's production template has 6 front-matter slides with venue map at slide 6, detail at 7, floor plan at 8. Off-by-one duplicated slide 6 thinking it was detail, wrote tokens to duplicates (silent no-ops because slide 6 doesn't have body tokens), wrote photo replacements against alt text that doesn't exist on legend slide, never duplicated slide 8. Hotfix shifts every slide-index reference by one.

### `{{venue_name}}` uppercase treatment

Producer feedback: venue names in deck headers feel weak in mixed case; ALL CAPS reads cleaner against Mirror brand. Single `.toUpperCase()` before repText. Only on `{{venue_name}}`.

### Loading-page copy refresh

"Compiling Pitch Deck" → "Compiling Deck Preview"; "Generating Pitch Deck" → "Generating Venue Deck". Output is preview deck for internal venue review, not fully designed pitch deck handed to client.

## Phase 4.8.2-port (Generating + vs-generate-deck)

### `vs-generate-deck` uses `getGoogleAccessToken` without impersonation

VS Pro's inline ~60 lines of JWT-mint deleted; imports `getGoogleAccessToken([presentations, drive])` from `_shared/googleServiceAccount.ts`. No impersonateUser because service account itself owns Drive + Slides calls and is a member of the Mirror Shared Drive holding template + output folder. Cache-keyed by `${impersonateUser ?? ""}|${sortedScopes}` so Gmail token and Drive+Slides token coexist without collisions.

### Error code surfacing pattern: `pipeline_error` as `<CODE>: <message>`

VS Pro returned `{error, code}` synchronously. Port uses `EdgeRuntime.waitUntil` so response is gone before failure surfaces; only channel back is `vs_scouts.pipeline_error`. Encoding: `${ErrCode}: ${message}` where ErrCode ∈ {AUTH_FAILED, TEMPLATE_COPY_FAILED, SLIDES_API_FAILED, NO_VENUES_INCLUDED, UNKNOWN}. Generating page parses with regex and routes to `/deck/error/<code>`. Simple, no schema change. Alternative typed jsonb column rejected as over-engineering.

### Failure path leaves `current_step='deck_prep'`

On any failure, function writes `status='failed' + pipeline_error=...` but does NOT touch `current_step`. Producer can re-trigger Generate without manually walking back through funnel. Same disposition as 4.7.2 leaving at `compiling` on failure.

### Deck name uses hyphen, not em dash

VS Pro template used literal em dash. Voice rule bans em dashes. Port: `${event_name} - Venue Pitch Deck v${version}`. `failWithCode("UNKNOWN")` writes are idempotent: outer catch may double-write but each call replaces status + error atomically, latest wins.

## Phase 4.8.1-port (Deck Prep + googleServiceAccount infra)

### `_shared/googleServiceAccount.ts` cherry-picked from failed-attempt

Failed-attempt Phase 4.6 already built the generic helper with exact shape: module-level cache keyed by `${impersonateUser ?? ""}|${sortedScopes}`, optional impersonateUser for delegation. Cherry-picked verbatim. `gmailServiceAccount.ts` refactored from ~130 lines (own JWT helpers) to ~30 (delegates to new helper). Public API preserved.

## Phase 4.7.2-port (Compiling + vs-compile-summaries)

### Reuse `vs_scouts.pipeline_error` column

Adding a `compile_error` column would split AI-pipeline failure into two physically-separate state machines for a single producer-facing concern. One channel means Researching + Compiling subscribe to same payload shape, ErrorStateStub keys co-locate, Scout Index renders single "had a problem" indicator without joining two columns. (Rename from `research_error` deferred to 4.10.3.)

### Compile timeout raised to 180 seconds

Compile arithmetic is per-venue. 5 pitched manual venues triggers up to 10 sequential Claude calls (Pass 1 fill + Pass 2 overview). At ~15s each = 150s of work; 180s gives 30s buffer. Research is a single call regardless of venue count, so its 120s ceiling stays appropriate.

### Notes flow + payload simplified

VS Pro reads `venue_notes` separately + requires `{project_id, venue_ids}` payload. 4.3-port already inlined notes into `vs_candidate_venues.notes`; vs-compile-summaries selects directly. Function queries pitched venues itself via `.eq("scout_id", scout_id).eq("pitched", true)`. Smaller payload, matches rest of port-side functions, centralizes "which to compile" server-side.

## Phase 4.7.1-port (Review + PhotoUploadModal + Shortlist photo unstub)

### `vs_venue_photos` bucket private + signed URLs

VS Pro's public `venue-photos` would expose deck photos to anyone with URL. HQ's bucket is private with RLS gated on `is_producer_or_admin()`. Display via `createSignedUrl(path, 3600)`. Storage path format includes a timestamp segment so re-uploads to a slot whose old object was just deleted don't serve a stale CDN image.

### HQ canonical `Field` at `src/components/ui/Field.tsx`

VS Pro's inline Field (10px uppercase muted label) lifted to HQ canonical. Distinct from heavier page-form Field shape used in Brief, NewScout, etc. (13px font-mono coral). Those pages keep inline definitions; consolidating into one with `variant` prop is a future job.

### PhotoSlot renders signed URL when `hasPhoto`

VS Pro's Review.tsx hardcoded placeholder for both states (apparent stub awaiting wiring). Port fixes: when `hasPhoto && photoUrl`, render `url(${photoUrl})`.

## Phase 4.6-port (Sourcing Report + Shortlist + matrix primitives)

### Frontend `venueTypes.ts` mirror; lock-step with `_shared/venueTypes.ts`

Same exports; any change touches both files in same commit. Header comments flag the rule. Drift produces mismatched type pills between matrix UI and AI/sheet source data.

### Notes inline on `vs_candidate_venues.notes`

VS Pro carries separate `venue_notes` table with row per venue. Port collapses to single nullable `notes text` column. Saves a round-trip, simplifies NotesModal save (single UPDATE), matches inline-on-parent pattern HQ uses for TS `internal_notes`.

### Matrix inside AppShell's `max-w-7xl` with horizontal scroll

VS Pro's matrix wraps in `max-w-[1860px]`. HQ's AppShell scopes every authenticated route to `max-w-7xl` (1280px), so matrix scrolls horizontally on most viewports rather than breaking out. Less optimal on wide monitors but stays inside AppShell idiom and avoids negative-margin escapes.

### Type-pill palette lifted verbatim from VS Pro

Per-type rgba palette is intentional desaturated brand-context color set with one tone per type. HQ design tokens don't define equivalent type-specific accents; substituting would lose at-a-glance signal. Lift literal rgba into `TYPE_STYLES`. Matrix column-header strip uses `bg-surface` (opaque) not `bg-secondary/30`: sticky col1+col2 headers, so 30% alpha lets horizontally-scrolled content bleed THROUGH the sticky cells.

### `Shortlist.debounceSave` widens patch type, splits `key_features` eagerly

Manual-row input emits raw delimited string. Original cast string into `key_features: string[]` via `as unknown as`, leaving a string in in-memory Venue. Type-lie that would crash consumers reading `.join`/`.map`. Fix: `debounceSave` accepts `VenuePatch` union and normalizes to array BEFORE writing state.

## Phase 4.5-port (Researching + vs-research-venues)

### `EdgeRuntime.waitUntil` + Realtime replaces sync-await

Port plan § 8.3. VS Pro awaits synchronous fetch for 30-90s. Port flips: function returns 200 immediately, work runs inside `EdgeRuntime.waitUntil`, page Realtime-subscribes (REPLICA IDENTITY FULL set in 4.1-port) + 3-second polling fallback. Faster perceived UX, graceful navigation-away.

### `pipeline_error` column for failure channel

Because page no longer reads failure off HTTP response, function needs persistent channel. `status='failed'` doesn't carry a message; `pipeline_error text` (nullable) does. Function clears at kickoff so retry starts clean, writes on any error path.

### URL quality lever stays off SYSTEM prompt

Per `feedback_tool_choice_collapse`: per-item gating in SYSTEM (or minItems under forced tool_choice) collapses output. SYSTEM lifted verbatim. URL quality enforced by two post-emission gates: (a) website_url schema description nudge (positive-only with examples), (b) `sanitizeWebsiteUrl` rejecting search pages + listing-DB homepages while letting deep links through.

### Idempotency via `brief_data.research_started_at` 90-second grace

`EdgeRuntime.waitUntil` runs after response, so page hard-refresh while research is in flight fires kickoff again. Without guard, doubles spend + INSERTs duplicates. Function checks: (a) `current_step !== 'researching'` skips, (b) `research_started_at` less than 90 seconds old skips. Otherwise stamps and proceeds.

### Empty sanitized result writes failure

After canonicalizeType + sanitizeWebsiteUrl + nameless-row filter, if `cleanVenues.length === 0` treat as research failure rather than INSERTing zero rows and flipping to `sourcing_report`. Surfaces issue to producer; silent zero-result would leave them on Sourcing Report with no candidates and no obvious "what now".

## Phase 4.4-port (Sheet Prompt + Sheet Upload + vs-parse-sheet)

### `type` → `venue_type` rename + naive PDF parse

VS Pro's `venues.type` reads as reserved word. Rename in 4.1-port migration. PDF parse stays naive: VS Pro returns 0 venues for PDF (pdfjs/unpdf path unreliable); port keeps same behavior, routes to `/sourcing/error/empty-sheet`. Real PDF table extraction is post-cutover. ErrorState full version lands in 4.9-port; 4.4 ships ~30-line `ErrorStateStub` to avoid 5-sub-phase 404 window.

## Phase 4.3-port (Brief)

### Brief is a single-page form; PDF parse is an affordance

VS Pro had no real brief surface. Port plan directs HQ-from-scratch. Shipped as single-page form modeled after `RoleSettings.tsx` (dirty-state, sticky save, beforeunload guard, cancel-leave dialog). PDF upload + parse lives ABOVE field stack as an affordance. No multi-step wizard. The failed-attempt 4.3.1 tried a wizard and carry-along cost wasn't worth it when there's only one card.

### `brief_data` canonical jsonb keys

Per port plan § 8.2 every brief field on `vs_scouts`. Three canonical 4.3 keys: `expected_guest_count` (consumed by vs-generate-deck), `notes` (freeform stringified into downstream prompts), `uploaded_files` (storage paths, append-only for audit/re-parse). Additional keys passed through from parse ride along; downstream prompts stringify whole jsonb so anything producer adds gets seen.

### `vs-parse-brief` (port) replaces failed-attempt in place

Same name, same slot, different signature + output shape. Uses Claude's native PDF reading via `document` content block (no unpdf round-trip). `verify_jwt = true` as explicit entry in config.toml: default is true but every prior `vs-*`/`ts-*` flipped OFF for self-invocation. Explicit entry advertises this as a deliberate choice rather than a missed config row.

## Phase 4.2-port (Scout Index + New Scout entry)

### `current_step` derives phase label; no schema column

VS Pro carried `projects.phase` text column maintained in lockstep with current_step. Port drops the column and derives via `currentStepToLabel()`. One source of truth, no drift.

### NewScout post-create navigates to eventual sheet-prompt route

`/venue-scout/scouts/:id/sourcing/sheet-prompt` doesn't exist yet (lands in 4.4). Post-create still navigates there because that's the correct eventual UX. 404 window is short; alternative (bouncing back to /venue-scout and forcing a row click) reads as regression once sheet-prompt exists.

## Phase 4.1 (Scout Dashboard; first Venue Scout surface)

### Venue Scout RLS: one permissive FOR ALL policy per vs_* table

All five vs_* tables got original four-per-table producer/admin-gated policies dropped and replaced with single `FOR ALL TO authenticated USING (true) WITH CHECK (true)`. Any authenticated HQ user can read/create/edit/delete any scout. VS is collaborative agency-wide workflow, not personal data. Creator scoping was default-safe starting point; this migration is the intentional unlock.

### `vs_sourcing_rounds` added to supabase_realtime in 4.1.1

Researching page (4.x) subscribes via postgres_changes. Added REPLICA IDENTITY FULL + ALTER PUBLICATION in 4.1.1 rather than deferring; deferring would require follow-up migration + re-deploy window. Precedent: `ts_pull_rounds` and `ts_final_reviews` both went into Realtime in same migration as table.

### `inDeck` stat uses `pitched && include_in_deck`

Spec text said `venues.filter(v => v.include_in_deck)` but the column defaults to true, so that would show every candidate as "in deck". Tightened so stat is meaningful from day one.

### Field.tsx extracted as canonical form label

12px Roboto Mono foreground label, coral required asterisk. Side effect: NewRoleDetails labels changed from 13px coral to 12px white. Old version was non-canonical.

### `venueTypes.ts` ported verbatim from VS Pro

CANONICAL_TYPES, TYPE_STYLES, TYPE_FALLBACK_STYLE, canonicalizeType, parseTypes copied without modification. Canonicalization heuristics preserved byte-for-byte so AI research output from existing VS Pro edge functions canonicalizes identically. Any future change to heuristics needs to be coordinated across both repos until VS Pro is retired.

## Phase 3.11 (Scorecard substance restoration + summary field)

### Restored substantive `full_points_rubric` and added separate `summary` field

The 3.7 squash added a "≤ 12 words, one sentence" cap to `full_points_rubric` to block tiered point breakdowns like "10 pts: 5+ yrs · 5 pts: 2-4 yrs". Intent was good; cap was over-aggressive and stripped concrete-signal evidence the per-candidate evaluator relies on. Outputs came back thin and abstract ("Strong portfolio") instead of rich and actionable.

Fix additively: `full_points_rubric` restored to 1-3 sentences (25-60 words) of concrete signals; bad-example block keeps the "no tiered point breakdowns" prohibition. New `summary` field (≤ 14 words) condensed recap for compact UI surfaces. Generated alongside in same Claude pass; never replaces. Both fields stored on the criterion (jsonb scorecard, no migration). Existing roles have only `full_points_rubric` (post-3.7 short); UI falls back to truncating it when summary is empty.

The defense-in-depth merge in `ts-refine-scorecard` extended: model trusted for name/full_points_rubric/summary; everything else (tier, weight, is_disqualifier, is_manual) restored from user input.

## Phase 3.10 (Scorecard refinement step)

### Refinement is a separate manual step, not auto-triggered

When user edits or adds criteria, refine pass doesn't fire automatically. Bottom-bar button morphs from "Approve & lock" to "Process scorecard". Two reasons: user is often making one edit in a stream of edits (auto-firing would burn spend and force redraw mid-edit); refinement is a non-trivial AI call (a few seconds, a few cents) so making it explicit ties cost to clear intent.

### Refinement preserves user scoring decisions via post-Claude merge

Prompt asks Claude to leave tier/weight/is_disqualifier/is_manual untouched, but `mergeRefinedIntoOriginal` re-applies user input regardless of what model returned. Belt + suspenders. Model trusted only for name + full_points_rubric. Worth lifting if we ever build other "refine user input via Claude" features: trust model for the field you're asking it to refine, mechanically restore the rest.

### Dead-criterion drop is server-side, before prompt

Criteria with weight=0 OR both name + full_points_rubric empty get dropped before refinement sees them. Prompt is told to preserve every entry; asking it to also drop dead ones is conflicting guidance. Burning tokens on empty refines is waste.

### Same edge function powers both scorecard surfaces

`ts-refine-scorecard` called by wizard step-3 (`NewRoleScorecard`) AND Edit Role (`RoleSettings`). Both share "scorecard edited since last refine → Process button" pattern.

### Tier re-sort happens client-side, not in prompt

After every refine, frontend re-sorts each tier highest-weight first. Model's order discipline is unreliable; we want predictable display contract regardless of what came back.

## Phase 3.8 + 3.9 (Cron, watchdogs, pull notification)

### Watchdog stall thresholds

Pull = 5 min (was 60). Re-eval = 30 min. Final review = 20 min. Pull pipeline updates `ts_pull_rounds.updated_at` at every per-candidate completion via the `updated_at_auto` trigger, so updated_at = "last candidate completed at"; heartbeats fire per candidate not per pool. A single candidate hanging >5 min is always a stall regardless of pool size. Earlier 60-min threshold was set under misconception that large pools legitimately sit between heartbeats; they don't.

Bulk re-eval writes `ts_roles.reeval_last_progress_at` per chunk (slower cadence than per-candidate), so 30 min is right. Final review is one call wrapped in `EdgeRuntime.waitUntil`; at HARD_CAP=50 lands in 5-10 min, so 20 catches dead workers without false-positives.

Pull-watchdog cadence bumped from every 5 to every 2 min so detection lands within 5-7 min of stall (vs 5-10). False-positive cost low because threshold is the actual signal of trouble. Status name aligned: pull-watchdog flips to `failed` (was `stalled`); user-facing surface treats both identically.

### Cron cadences + cap-alert recipient

Watchdogs every 5 min. Scheduled pulls daily 12:00 UTC. Storage cleanup daily 03:00 UTC. Spend reset 1st of month 00:01 UTC. `getAdminEmail(sb)` returns oldest active admin, falls back to `jobs@mirrornyc.com`. Oldest-admin over hardcoded so alert routes correctly if Jimmie transfers admin ownership without updating env vars.

### Pull-completion notification: standalone in 3.9, fold later

Ships as standalone edge function to unblock TS's happy path. Unified `notifications-dispatch` is Phase 5 work; building 3.9 against future API would gate TS on Phase 5. Standalone lets Phase 5 swap the call site (one-line replacement). Fire-and-forget via `EdgeRuntime.waitUntil`.

### `pg_cron` through SECURITY DEFINER helper

`public.invoke_edge_function(fn_name, body)` reads two GUCs and POSTs with internal-secret header. Keeps secrets out of `cron.job` rows (queryable by anyone with pg_cron permissions). Makes schedule SQL readable; adding a new cron is one line. GUCs set out-of-band; without them helper warns and no-ops, so migration is safe to apply before GUCs populated.

## Phase 3.7 (Candidates UX + referral ingestion)

### `manually_reviewed` boolean as one-way flip; `auto_rejected` enum value deprecated

Hiring managers needed a way to lock candidate decisions against future re-evals. Adding per-candidate `manually_reviewed` (default false) is the cleanest split: AI eval/re-eval leaves it false; user actions flip to true. Re-eval respects the flag (when true, score/strengths/gaps/overview update but status doesn't). Bulk re-eval defaults to `not_manually_rejected` (`status.neq.reject,manually_reviewed.eq.false`). The `auto_rejected` enum became redundant once `manually_reviewed=false + status=reject` carries same semantics. Backfilled existing rows. Enum value kept (dropping requires full enum rebuild, not worth it). New writes never use it.

### Referral identity = original applicant; `referrer_email` captures manager

When manager forwards to jobs@, the candidate row's identity is the original applicant's name + email, NOT the manager's. Manager goes on separate `referrer_email`, paired with `is_referral=true`. Eval is blind to referral status (same prompt). Referrals get UI affordance (electric-blue ReferralPill) but no scoring lift. Keeps master-pool ordering meaningful regardless of source. Tried `referral` as status enum first; rejected because referral isn't an outcome state, it's a source flag.

### Forward parser walks every chain segment, picks deepest non-Mirror

Single regex looking for first `From:` header would lock onto manager (`@mirrornyc.com`) instead of original applicant. Parser collects every `From:` AND every `On <date> <Name> wrote:` attribution into positions-sorted hits list, then walks in reverse to pick deepest sender whose email isn't `@mirrornyc.com`. When every hit is Mirror, returns null and message is skipped. Apple Mail iPhone forwards (original applicant as quoted reply not re-headered forward) covered by wrote-attribution branch.

### Capture every Mirror manager's commentary into `internal_notes`

Managers often forward with their own context ("strong fit, schedule a call"). When that commentary lands in jobs@'s body, it's the most reliable signal we have. `extractManagerNote` walks every explicit-forward segment, parses each `From:`, and for any Mirror sender captures body with signatures stripped (bolded-name + brand-marker heuristic) and "from-mobile" Apple Mail tags filtered. Multi-manager chains attribute each note with `Note from <email>:`. Folded into FIRST eval via `HIRING MANAGER NOTES:` block in candidate bundle (eval prompt treats that block as verified context superseding resume/cover-letter inferences).

### `mirrornyc.com` blocked from portfolio URL extraction

Manager email signatures embed `http://www.mirrornyc.com/` and `@mirror_nyc`. Portfolio scorer was promoting those as candidate's portfolio. Added to `BLOCKED_PORTFOLIO_DOMAINS` in `_shared/unwrapUrl.ts`.

### Global competitor list as `text[]` on `global_settings`; per-role override on `ts_roles.competitor_bonus`

19-entry list of competitor agencies that bonus-credit candidate experience across every role. Stored as `text[]` on global_settings (flat, simple membership check). Per-role override stays on `ts_roles.competitor_bonus` (jsonb, carries bonus_points scalar alongside array). Seeded via two migrations (conditional UPDATE + idempotent DO block).

### Stepped pull-running checklist driven by existing signals

Source repo writes per-step state to `step_progress` jsonb on `pull_rounds`. HQ port dropped that in 3.4 to keep `ts-pull-candidates` simple. Stepped UI derives 4-step checklist (search/dedupe/process/save) from existing `candidates_found` + `processed_count` + `status`. Less granular than source's 6-step but covers practical UX without re-adding per-substep writes.

## Phase 3.6 (Final review + packet)

### Split into two edge functions, share via `_shared/packetRender.ts`

Source ships two ~800-line packet generators (`generate-packet` round-scoped, `generate-final-review-packet` review-scoped) sharing ~50% of code. Consolidating into one would mean 200-line if/else inside renderer because cover, body table (matrix vs rankings), writeup categories, classification semantics differ and pull from different DB tables. Split into `ts-packet-generate` + `ts-final-review-packet`, lift shared infra. Net: each domain function ~250 lines, shared ~400 lines, ~44% smaller than source's 1,599 combined.

### `final_overview` field on each `ts_final_reviews.final_rankings` entry

Source had no equivalent. Reviewing managers need a comparative angle that per-candidate `quick_overview` (generated at pull-time) doesn't provide; quick_overview is "what's in this candidate's materials"; final_overview is "what unique strengths or angles this candidate brings to Mirror NYC that distinguish them within this final pool." AI generates 4-6 short headlines framed as positives (never direct comparison; comparative reading is what the manager does, not the AI). Surfaced in FinalReviewDetail's candidate table where dashboard CandidateTable would show Quick Overview.

### `unwrapSecurityWrapper` ported and applied broadly

Email-security services (Outlook safelinks, Mimecast, Proofpoint URLDefense, etc.) wrap outgoing links so clicks route through their redirect. When candidates send portfolio links from corporate accounts, wrappers leak into HQ via Gmail ingestion. Ported to `src/lib/unwrapUrl.ts` and applied everywhere a portfolio URL is rendered.

### `include_fast_track` toggle on FinalReviewDetail

Default true. Managers occasionally want tighter top-tier-only packet; toggle gives that escape. Seeded from `packet_include_fast_track` so re-generation defaults to previous preference.

### Tier subtotals render em dash when score_breakdown is empty

Used to show T1=0/T2=0/T3=0/Bonus=total when breakdown was empty (legacy or AI returned none). Reads as "candidate scored zero on Tier 1" rather than "we don't have the breakdown." Now renders em dash per missing tier; total still renders correctly.

### HQ-specific: skip Gmail re-fetch, read attachments from Storage

Source re-fetches via OAuth refresh tokens. Phase 3.4 already persists every attachment to `candidate_attachments` on initial pull, so HQ doesn't need the round-trip. `_shared/packetRender.ts` reads from Storage. Cleaner path, no Gmail dependency at packet time, faster.

### HQ-specific: email packet via Gmail service account + PDF coral preserved

Source returns download URL only. HQ adds email step: sends PDF from jobs@mirrornyc.com via service account's `gmail.send` scope. Best-effort: failures don't fail overall request. 3.5b brand pass moved HQ's UI coral to `#BE4E44`; PDFs keep source's `#ef5b5b` because dustier coral reads dim on paper print + PDF previews.

### `ts_candidates.email_body_text` column added

Source shows candidate's original application email as doc-slot page. HQ didn't persist in 3.4. Added nullable column; `ts-pull-candidates` populates (trimmed at 30k chars). Pre-3.6 candidates lack it but title page + attachments still render.

## Talent Scout port (Phase 3): locked Q1-Q6

Resolutions to six open questions surfaced during Phase 3.1 port-plan inventory.

### Q1: re-eval history → keep

`ts_evaluations` is separate history table. Every re-eval INSERTs a new row preserving prior scores. Latest row mirrors onto `ts_candidates` for fast list queries. Bulk re-evaluate is the one exception: implies prompt/scorecard changed so prior evals not meaningful. `overwrite_history: true` flag deletes prior `ts_evaluations` rows before insert.

### Q2: pending-candidate parking → jsonb on round

`ts_pull_rounds.pending_candidates` (jsonb default []) holds Gmail message IDs the chunked pipeline batches in groups of 8 across self-invocations. Matches source shape; no separate table.

### Q3: hiring manager identity → block on first sign-in

`ts_roles.hiring_manager_id` FKs to users. Wizard looks up by email at submit. If no users row exists, role creation blocked: "Hiring manager must sign in to HQ at least once first." No auto-creating users from email strings.

### Q4: notification consolidation → standalone first, fold later

Phase 3.8 ships `ts-send-pull-notification` standalone so TS doesn't block on Phase 5. Phase 5 folds into `notifications-dispatch`.

### Q6: anthropic-spend-tracker → explicit `callClaude(app, ...)` wrapper

Single helper in `supabase/functions/_shared/anthropic.ts`. Selects key from `ANTHROPIC_API_KEY_TS / _VS / _HQ` based on `app`. After each call computes cost from response usage (incl. prompt-cache discounts) and increments `global_settings.anthropic_spend_current_month_usd`. Emails admin once per cap crossing, gated by `cap_alert_sent_this_month`. Does NOT refuse calls when over cap; graceful degradation, not hard failure.

## Phase 3.4 (pull pipeline)

### Edge Function self-invocation auth

Supabase gateway rejects service-role bearer at its `verify_jwt` layer (likely new-format vs legacy-JWT mismatch). Solved with per-function `verify_jwt = false` + `INTERNAL_API_SECRET` shared secret + auth enforcement in `_shared/internalAuth.ts` (three accept-paths: internal-secret header, service-role match, valid user JWT). See `docs/auth-model.md`. Any future self-invoking function uses same pattern.

### Realtime publication

`supabase_realtime` on this project starts empty. `ts_pull_rounds` added via migration with REPLICA IDENTITY FULL so PullDetail's postgres_changes UPDATE subscription receives the full new row. Future subscribed tables need same.

### All attachments to Storage (drift from source)

Source kept small attachments in Gmail and let dashboard fetch on demand via `gmail-attachment` Edge Function. HQ persists every attachment to `candidate_attachments` bucket regardless of size. Slightly more Storage cost; much simpler download path; no separate function for detail viewing.

### `ts_pull_rounds` operational columns

`candidates_found`, `processed_count`, `attempt`, `round_number` added so progress + round labels work without joining `ts_candidates` per render. Source's `step_progress` jsonb / `current_step` / `error_log` dropped; simpler `processed_count / candidates_found` is enough.

## Phase 3.5 (candidate detail + re-eval)

### `promote` → `interview` enum rename + status sort

Original used `promote` as "advance" status. Renamed; concrete next-stage action mapping to hiring workflow language. `ts_candidate_status` is now (consider, interview, reject, fast_track, auto_rejected). CandidateTable sorts by status bucket first (Interview → Fast-Track → Consider in active; Rejected → Auto-Rejected in collapsible tier), then by user-selectable column.

### Bulk re-eval split: role-scoped vs round-scoped

`ts-bulk-reevaluate` (chunked self-invoke) operates on role's master pool with optional status_filter. PullDetail's "Re-Evaluate Pool" is round-scoped and skips the dedicated function; fans out parallel `ts-evaluate-candidate` calls (concurrency=6) with `overwrite_history: true` from browser. Source put bulk-reeval state on pull_rounds; HQ moved to role-scoped (`reeval_*` columns on ts_roles).

### Status dropdown writes awaited before parent refetch

`StatusDropdown.onValueChange` awaits DB UPDATE before calling onChange. Calling onChange first races the write and leaves displayed value one click behind. Future inline-mutation components in HQ follow same order.

## Phase 2 (schema + auth)

### `handle_new_user` Postgres trigger replaces `auth-on-signup` Edge Function

Original spec called for Edge Function. Implemented as Postgres trigger on `auth.users` instead, running with service-role privileges. Simpler, atomic with auth.users insert, no cold-start latency. Function name reserved in case extra signup-time work needed later.

### Project security defaults: Auto-expose OFF, Auto-RLS ON

Every new table requires explicit `GRANT` to `authenticated` and `service_role`. Forces every new table to be reviewed for which roles can hit Data API at all, separate from RLS row-level policy.

## Open

- **Project status enum trim.** Current 14 values may consolidate. Defer until Phase 5 polish.
- **TS data extraction** (future cross-platform; not blocking Phase 5). Plan: re-create active roles via Gmail re-pull, preserve closed roles as packet PDF archives.
