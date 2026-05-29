# Decisions

Architectural decisions worth preserving with their rationale. Newest at the top within each section. Shipped phases are consolidated to their still-binding decisions plus pointers to the canonical home (schema -> `schema.md`, RLS/auth -> `auth-model.md`, edge behavior -> `edge-functions.md`, design canon -> `design-system.md`, history -> `v1-changelog.md`); the full per-sub-phase narration lives in git history.

## Phase 6.0: tech-debt Top-5 + quick-wins (2026-05-29)

Acting on the Phase 6.0 tech-debt audit after F001. Frontend fixes landed on branch `claude/phase-6-0` (pending the 6.0 squash, not separately deployed): F011/F002/F005 (the `syncJoinRows` helper + join-write error surfacing across ProjectEdit/VenueEdit/VendorEdit/PersonEdit), F006 (Recent Activity entity_type singular/plural), F018 (Index `fmtRelative` "0h ago" drift), F024 (unread-count `delivered_in_app` guard), F045 (ScoutIndex delete-preview error surfacing), F052/F053 (dead-code + over-export removals), F056 (`@playwright/test` drop + `knip.json`), F058/F059/F063 (polish). The edge + migration fixes below are out-of-band (prod leads `main` until the squash), same lane as F001. Deferred findings are tracked in `code-observations.md`.

### D1: F003, four user-FKs missing ON UPDATE CASCADE (sign-in lockout)

`project_tags.created_by`, `venue_features.created_by`, `city_aliases.created_by`, `neighborhoods.created_by` were created after the 5.8.8.1 standing rule but defaulted to `ON UPDATE NO ACTION`, so a pre-provisioned author of any such row would hit `ERROR 23503` on the first-sign-in id-swap. One migration ALTERs all four to `ON UPDATE CASCADE`, **preserving each table's existing `ON DELETE`** (NO ACTION on tags/features, SET NULL on aliases/neighborhoods); harmonizing tags/features to SET NULL is a deferred product call, not taken here. Closes F021: the `auth-model.md` invariant query returns 0 again.

### D2: F004, atomic Anthropic-spend RPC (lost-update + double-alert race)

`trackSpendAndAlert` ran a non-atomic SELECT-then-UPDATE on the single `global_settings` row; concurrent `callClaude` (VS `Promise.all`) dropped spend (last-write-wins) and could double/skip the cap-alert. New `increment_anthropic_spend(p_cost)` (SECURITY DEFINER, `search_path` pinned, service-role-only per RPC-posture pattern 2) increments under `SELECT ... FOR UPDATE` and sets `cap_alert_sent_this_month` iff this call crosses the cap, returning before/after/cap/just_crossed so exactly one caller emails. The edge wrapper now just calls the RPC and emails on `just_crossed`. `anthropic_call_log` already held exact per-call cost, so the breakdown surface is unaffected. Chose the richer RPC (handles the alert flag too) over the audit's minimal increment-only rec to also close the double-email race.

### D3: F019, MIME header injection via unsanitized To/Subject

`buildMime` (sendEmail.ts) and `buildLinkMime` (packetRender.ts) interpolated `to`/`subject`/`from` into raw header lines with no CR/LF strip; admin-supplied `role.title` flows into the packet subject. Promoted `stripMimeControl` to `_shared/mimeHeader.ts` and run all three header values through it. The pre-existing local copies in `notify-admin-of-pending-user` / `notifications-dispatch` (which sanitize their own body values) are left as-is to keep the redeploy surface tight; they could adopt the shared helper later.

### D4: F035, reeval_total counted the wrong set

The `ts-bulk-reevaluate` start-path count applied only the filter's `include`/`exclude`, not its `manuallyReviewed`/`orExpr` clauses that `listPendingCandidates` applies, so `reeval_total` over-counted and the progress bar never reached 100%. The count query now mirrors `listPendingCandidates` exactly.

### D5: F054/F055/F057, dead code + an em dash

`ts-pull-candidates` dropped two imported-but-unused symbols (`unwrapSecurityWrapper`, `LARGE_ATTACHMENT_THRESHOLD_BYTES`) and the `void`-binding hack that kept them lint-quiet. `_shared/unwrapUrl.ts` dropped the orphaned `buildGmailAttachmentUrl` (built a URL to a nonexistent `gmail-attachment` function; zero callers). `ts-packet-generate`'s round-packet email signature changed its leading em-dash prefix to a hyphen before `Mirror NYC HQ` (no-em-dash rule; matches `ts-final-review-packet`).

### D6: Deploy posture

Edge redeploy sets: F057 -> ts-packet-generate; F054 -> ts-pull-candidates; F035 -> ts-bulk-reevaluate; F055 -> functions bundling `_shared/unwrapUrl.ts`; F019 -> functions bundling `_shared/sendEmail.ts` (all email/callClaude functions) + `_shared/packetRender.ts` (ts-packet-generate, ts-final-review-packet); F004 -> all `callClaude` functions, AND the `increment_anthropic_spend` migration must be applied first. F003 is a pure migration (`supabase db push`), no edge deploy. Each deploy is gated on Jimmie's go (same as F001).

## Phase 6.0: F001 server-side admin gate on Talent Scout edge functions (2026-05-29, deployed out-of-band)

First fix out of the Phase 6.0 tech-debt audit; closes the audit's lone Critical, **F001**. No migration; 8 edge files (1 shared helper + 7 functions) redeployed out-of-band 2026-05-29 + 2 backend docs updated in the same change. Lives on branch `claude/phase-6-0` pending the eventual squash to main.

### D1: The hole, authentication without authorization on RLS-bypassing TS functions

The 7 `verify_jwt=false` admin-only Talent Scout functions (`ts-pull-candidates`, `ts-bulk-reevaluate`, `ts-evaluate-candidate`, `ts-final-review`, `ts-packet-generate`, `ts-final-review-packet`, `ts-send-pull-notification`) gated only on `requireInternalOrUserAuth`, which returns null for ANY valid user JWT, then built a `SUPABASE_SERVICE_ROLE_KEY` client (RLS fully bypassed). `/talent-scout` is admin-only via the client-side `<AdminRoute>` only. Net: any signed-in non-admin (standard/freelance) could hand-craft a fetch with their own JWT and drive admin-only TS operations: mutate `ts_candidates`/`ts_evaluations`, kick off bulk re-evals, burn Anthropic spend, and generate packets whose responses carry signed-URL PDFs of candidate PII. Privilege-escalation / IDOR; the adversarial-verify pass bumped it High -> Critical.

### D2: Fix = new `requireInternalOrAdminUser` helper, admin re-check on the user-JWT branch only

Added a sibling helper in `_shared/internalAuth.ts` rather than changing `requireInternalOrUserAuth` (still used by the 9 cron functions). It keeps the internal-secret and service-role-key early-returns byte-identical, so every machine caller (cron, self-invoke) passes through with NO role check; only the plain-user-JWT fall-through additionally reads `public.users.permission_role` (anon client + forwarded `Authorization`, so the read runs under the caller's own RLS self-read clause, `users_select`, 5.16.0 D5) and requires `'admin'`. Mirrors the proven `bulk-import` server-side re-check, and improves on its one weakness: a transient role-read failure returns **500** (retryable), not a misleading 403; a genuinely-absent / non-admin row returns **403**; missing/invalid JWT returns 401.

### D3: Scope = exactly the 7; crons and scorecard fns deliberately excluded

A 12-agent mapping pass + manual trace confirmed every self-invoke / cron path sends BOTH `x-internal-secret` AND `Authorization: Bearer <service-role>` (ts-bulk-reevaluate -> ts-evaluate-candidate; ts-pull-candidates -> ts-send-pull-notification + self-continuation; ts-cron-scheduled-pulls -> ts-pull-candidates), so none break under the admin check; every UI caller is `<AdminRoute>`-gated (always an admin JWT). The 9 `ts-cron-*` / `hq-cron-*` functions stay on `requireInternalOrUserAuth` (pg_cron is their sole real caller via the internal secret; an admin gate is inappropriate, and tightening them to `requireInternalSecret`-only is a deferred separate item). The 2 scorecard fns (`ts-generate-scorecard`, `ts-refine-scorecard`) are NOT in F001: they hold no DB client (body-in -> Claude-out), so they are not an RLS/PII risk, only non-admin Anthropic spend; low-priority, deferred.

### D4: Verification + deploy

eslint clean on all 8 files; a 4-lens adversarial review (bypass / broken-caller / correctness / completeness) returned zero code defects. Deployed the 7 via `supabase functions deploy` (each bundles the updated `_shared/internalAuth.ts`); an unauthenticated probe returns `401 {"error":"Unauthorized"}`, confirming the live gate. Out-of-band edge deploy: no Netlify credits, no migration. `docs/auth-model.md` § Edge Function self-invocation auth + `docs/edge-functions.md` § internalAuth document both helpers and the when-to-use rule.

## Phase 6.0: capability clusters 6.1-6.5 (smoke punch-list; frontend/UX, 2026-05-29)

The pre-team-rollout smoke punch-list, shipped as five frontend/UX capability clusters under Phase 6.0. All ride the single 6.0 squash (`<pending 6.0 squash>`); the per-cluster feature-branch commits (6.1 `0b6f800`, 6.2 `37a293e`, 6.3 + 6.4 `5044439`, 6.5 `c9ec706`, 6.5 follow-up `54c1f35`) are folded into it, not standalone ship points. Pure frontend + CSS except the additive `venue_files` migration (D6). The design-system canon for all of these lives in `docs/design-system.md`.

### D1: 6.1 table-system cluster

The ScoutIndex `.tbl-list` contract (surface-alt rows, per-cell dividers, surface header bg) was lifted onto all 7 HQ Core DataTable list pages (Projects, Tasks, Deliverables, Venues, Vendors, People, Clients), retiring the "HQ Core list-page `.tbl-list` sweep" carry-forward. Per-surface column alignment uses the EXISTING `.l` / `.c` classes + the DataTable `align` prop; no new alignment classes were introduced. A new muted `.tbl-done` divider class (surface + subtle-foreground + border) was added for the two-tier "Done · N hidden" terminal footer, distinct from the coral `.tbl-divider` section header (which the spend table keeps). Settings carve-out: the AnthropicSpend numeric columns stay right-aligned (numbers read right), the one sanctioned exception to the left/center list default.

### D2: 6.2 card-title canon

Locked the canonical card title as `.h-card` inside a `.card-headbar` for every card, app-wide. The sweep flipped the remaining `.block-lbl` / `.label-section` card-title holdouts (TeamMemberEdit, ProfileSettings, WikiPageEdit) onto it and converted SheetUploadCard from shadcn `<Card>` / `<CardContent>` to the canonical `.card` + `.card-headbar` + `.card-pad`. `.label-section` is demoted to its real job (in-body form-section sub-labels and labels above lists/reports) and is NEVER a card's title. (Calendar / Outlook grid background tokens were retuned in the same cluster so the header reads darker than the body, matching the `.tbl` contrast direction.)

### D3: 6.3 DateField primitive

Built a new `src/components/ui/DateField.tsx` (ISO `{start, end}` value, single-or-range, `variant` prop: boxed input for ProjectEdit / New, inline transparent for ProjectDetail) rather than extending the VS `DateRangePicker` (display-string + range-only, built for VS `text` columns). This is the dual-contract picker that 5.16.1.1 D7 deferred. Convention: a single (non-range) date stores as `{start: <iso>, end: null}`; end-null is the canonical "single date" shape, so range and single share one column contract.

### D4: 6.4 N3 input-contrast pivot

`.hq-form` inputs / selects + RecordCombobox triggers now render a contained dark fill (`hsl(var(--input))` + `--border-strong` + coral focus), reversing the Phase 5.7.5 transparent inline-edit chrome on the no-click edit/new form surfaces (the transparent treatment stays on the click-to-edit detail surfaces). `.vs-input-contrast` carries the same fill to the VS brief surfaces (BriefEvent / BriefVenue + the New Scout modal); TagInput pills bump to `--border-strong` so they don't blend into the filled container. Token = `--input` (Jimmie confirmed he likes the grey, applied to VS too; swap to `--background` only if true black is wanted later).

### D5: 6.4 eyebrow reversal (Detail-pages-only)

The `.pagehead` eyebrow was removed from the 9 HQ Core edit / new forms (the `.pagehead` wrapper + h1 stay). The eyebrow is now Detail-pages + ProfileSettings only; Edit / New pages do NOT carry it. Reverses the prior "eyebrow on Detail and Edit pages" rule recorded in `design-system.md` § Page header.

### D6: 6.4 venue_files hardened from the start

`venue_files` (a mirror of `vendor_files`, vendor->venue) was created directly in the post-5.16.0 hardened posture: `is_active_member()` RLS on SELECT/INSERT/DELETE (no UPDATE policy; delete + re-add only) + `created_by` `ON UPDATE CASCADE ON DELETE SET NULL` per the auth-model.md FK invariant, NOT the original `vendor_files` open-`true` posture the spec wording described. Migration `20260613000000_phase_6_4_venue_files.sql`, applied to the linked DB out-of-band during 6.4 implementation (types regenerated; `docs/schema.md` entry added). Surfaced: VenueDetail Files & Assets card + VenueEdit section.

### D7: 6.4 H5 Home inline-edit exception

Home's My Tasks card gained a clickable Status ClickPillCell (before Priority); setting Done removes the row, matching the Done checkbox. Home is otherwise read-only-with-links; this is a deliberate, isolated inline-edit exception because the status flip is the card's primary affordance.

### D8: 6.4 P7 ProjectDetail Schedule layout

ProjectDetail's read-only Schedule block was restructured to a 2-row grid (Install + Removal stacked, Live spanning both, Next Deliverable right of Live). The editable DateField card (6.3) is untouched; this is layout-only on the read surface.

### D9: 6.5 actionbar arrow convention + 3-zone layout

All 14 `.actionbar` consumers converged on the canonical `.btn` pattern: Back / Cancel = `.btn btn-tertiary`, primary = `.btn btn-primary`, NO shadcn `<Button>` in actionbars. The arrow convention (refined in the 6.5 follow-up against Jimmie's smoke): the leading `IconArrowLeft` means back-NAVIGATION only: kept on every Back, REMOVED from every Cancel / discard. Layout: 2-zone bars put Cancel far-left + primary far-right; 3-zone bars use `grid-cols-[1fr_auto_1fr]` (back/leave far-left, a secondary action truly centered, primary far-right). The bulk-import wizard is the one bar carrying BOTH a Back (arrow, far-left) AND a Cancel (no arrow, centered), because its Stepper is a non-clickable progress indicator so the wizard needs an explicit step-back affordance.

### D10: 6.5 RecordCombobox search + create

Canonical combobox behavior, not just visual polish. (a) Search: cmdk fuzzy is disabled (`shouldFilter={false}`); a manual case-insensitive substring / prefix filter runs over the canonical options AND alias rows (so city-alias search survives). (b) Create: `miniCreateFields` wins. Any source WITH miniCreateFields (multi-field, e.g. Client = name + industry) always opens MiniCreateModal; single-field sources (no miniCreateFields, e.g. Venue) add immediately from the typed text on Enter / "+ Add" via a deterministic `createFromInput()` handler (an `onKeyDown` on CommandInput fires create when the typed text matches no option/alias), with no confirm modal. `quickCreate` is now vestigial (retained for call-site compat). The over-eager single-"name"-field `VENUE_MINI_CREATE_FIELDS` was removed from the two venue pickers so venue adds immediately.

### D11: 6.5 VenueType palette pivot (supersedes the VS-Pro do-not-touch lock)

The VenueType pill palette was replaced: out goes the desaturated "VS Pro" rgba scale (read pastel / floral), in comes a bold design-system HSL status-pill scale (fill ~22% / bright text / border ~55%, mirroring `src/lib/venue-scout/format.ts`). Four types map to the exact HQ accent tokens (Event Venue = `--info`, Warehouse = `--warn`, Gallery = `--purple`, Outdoor = `--success`); the rest are bold hues in the same idiom; coral (`--primary`) is reserved. Comma-form `hsla()` is required because Tailwind drops an arbitrary value carrying an in-bracket `/ alpha`. This SUPERSEDES the long-standing "lifted verbatim from VS Pro / do-not-touch `TYPE_STYLES`" lock (and the interim 6.5 V3 alpha-bump). Exact hues / alphas remain a live tune.

### D12: v1.0 multi-value delimiter flipped to pipe-only (reverses 5.16.1.1 D9)

The bulk-import / CSV / template / import-UI multi-value separator is now PIPE `|` ONLY. Slash `/` is a literal character and never splits a value (valid values like `Theatre/Auditorium` and `Indoor/Outdoor` stay whole); comma `,` is the CSV column delimiter only, never a multi-value separator (so a producer never quotes a cell just to express multiples). This reverses the 5.16.1.1 D9 contract (`/` + `,` canonical, `|` accepted in transition), which wrongly split slash-containing values. The shared `splitMultiValue` (`src/lib/multiValue.ts` + the byte-equivalent `supabase/functions/_shared/multiValue.ts` mirror) splits on `|` alone; HQ bulk-import (refEnumerate / splitMulti) and `vs-parse-sheet`'s venue_type input split both consume it; the 3 CSV templates, the RefResolvedCell placeholder, and the VS sheet-template producer copy moved to pipe. FLAGGED, NOT changed (separate live parsers): the VS-internal `venue_type` stays slash-joined and is slash-split by `parseTypes` / `sanitizeMultiAgainst` (and the AI emits slash-separated types), so a slash-containing compound type is still split by the VS matrix; realigning that whole VS type pipeline to pipe is a larger cross-cutting change deferred to the post-v1.0 backlog. The `vs-parse-sheet` key_features inline split (comma / semicolon / pipe / newline) is likewise left tolerant; only its producer copy now prescribes pipe.

## Phase 5.16: v1 wind-down cycle (2026-05-28, complete)

Squash `f138c23`. Four sub-phases (5.16.0 freelance flatten + tier hardening; 5.16.1.0 Vite upgrade; 5.16.1.1 lint-to-zero; 5.16.1.2 advisor focused) collapsed into one consolidation squash. Per-phase narrative in `docs/v1-changelog.md` § 5.16. The 5.16.0 RLS/auth invariants are canon in `docs/auth-model.md`; 5.16.1.2's intentional advisor carve-outs are documented in `auth-model.md` § Intentional SECURITY DEFINER advisor warnings. Still-binding decisions:

- **Freelance flattened to standard (5.16.0).** The drafted row-scoped freelance-contributor model (`is_project_member()` helper, read/write only assigned projects) was dropped (Jimmie's call); freelance now equals standard, the `freelance` enum persists only as a visual badge, no `is_project_member()` helper exists. The valuable half (the security hardening) shipped without the complexity. The hardening closed the Phase 5.11.0 pending-user raw-PostgREST leak; `is_active_member()` (`permission_role <> 'pending' AND active`) is the standing RLS predicate, `users_select` keeps an `OR id = auth.uid()` self-read clause so pending users resolve their own row for the `/pending` redirect, and the Account Logins freelance-block survives the flatten. See `auth-model.md`.
- **Bulk-import RPC GRANT lockdown (5.16.1.2).** The four `bulk_import_commit_*` / `bulk_import_undo` RPCs are `service_role`-only (REVOKE FROM PUBLIC, anon, authenticated). They are invoked only by `bulk-import/index.ts` via the service-role client; the in-function `actor_id='admin'` re-check stays as defense in depth. Pattern lifted from 5.12.1's kickoff RPCs. Documented in `auth-model.md`.
- **Trigger fns keep `authenticated` EXECUTE (5.16.1.2).** `users_align_id_to_auth` + `users_protect_admin_columns` retain `authenticated` (revoke only anon + PUBLIC): the Team-page add-member insert (`TeamMemberEdit.tsx`) runs as `authenticated` and fires the BEFORE INSERT trigger, and trigger-function EXECUTE IS enforced in this project (root cause of the 2026-05-19 sign-in lockout). The residual 0029 advisor flag is intentional. Do NOT revoke. See `auth-model.md`.
- **CSS minifier pinned to esbuild over Vite 8 Lightning CSS (5.16.1.0).** Lightning CSS hard-errors on empty-selector `!important` rules that Tailwind's JIT emits from false-positive bare-word `!` candidates; esbuild silently dropped them across Vite 5/6/7. Pinned `build.cssMinify: 'esbuild'` until 5.16.1.1 fixed the Tailwind JIT source, after which the override drops and Lightning CSS becomes the default. `engines.node` mirrors Vite 8's floor verbatim across `package.json` / `.nvmrc` / `netlify.toml`.
- **Lint baseline to zero, edge tree permanently in the lint contract (5.16.1.1).** Full-repo baseline burned 191 -> 0 with REAL typing and 0 inline disables; the edge tree (161 of the errors) is back in the eslint contract permanently to stop the `no-explicit-any` debt re-accumulating.
- **Edge `Database` types wired, adoption opportunistic (5.16.1.2 D12, supersedes 5.16.1.1 D2).** `_shared/database.types.ts` now exists in the Deno tree (generated, matches the frontend types). New edge functions that select a full row import it and use `Database["public"]["Tables"][...]["Row"]`; existing intentionally-narrow `.select()` interfaces are retrofitted opportunistically, not swept, since the full Row over-fetches the type surface. (F038 notes this module is still imported by zero edge functions and has drifted; tracked in `code-observations.md`.) Convention in `conventions.md` + `edge-functions.md`.
- **`xlsx` -> SheetJS, edge bundler can't import arbitrary CDN hosts (5.16.1.2 D10).** The npm `xlsx@0.18.5` prototype-pollution + ReDoS advisories (no npm fix) closed by a lazy dynamic CDN import of SheetJS 0.20.3 on the frontend (only on `.xlsx` upload). The Supabase edge deploy **bundler rejects `cdn.sheetjs.com`** ("Cannot import from cdn.sheetjs.com:443"), so `vs-parse-sheet` imports a vendored local copy at `_shared/vendor/xlsx.mjs` (eslint-ignored). Standing rule: edge functions can only import from `esm.sh` / `npm:` / `jsr:` / a vendored local file. `npm audit` is 0.
- **HQ Bulk Import header normalization (5.16.1.2 D14).** The Review grid rendered blank cells for any sheet whose headers did not exactly match the internal column keys (the pipeline reads `row[col.key]` and there was no header->key map). Fixed in two layers: auto-match (`normalizeHeaders.ts`, normalized-token map against `col.key` + `col.label`) + a manual column-mapping UI at the Upload step (required-field guard, duplicate-target warning). Entity-agnostic; placement is the Upload step so the mapping finalizes before any downstream step runs.

## Phase 5.15: Anthropic per-tool call-log infra + spend breakdown surface (2026-05-28, complete)

Squash `1814867`. 4 sub-phases collapsed. Two migrations (`20260608000000_...anthropic_call_log.sql` + `20260609000000_...spend_breakdown_window.sql`); 11 edge redeploys; 5 frontend files. Per-phase narrative in `docs/v1-changelog.md` § 5.15. The `.tbl-list` / `.tbl-divider` canon (former D9/D10) lives in `docs/design-system.md` § 4; the admin-only RLS on `anthropic_call_log` + the breakdown RPC is in `docs/auth-model.md`. Still-binding decisions:

- **Storage shape = per-call rows, not pre-aggregated buckets (D1).** Append-only `public.anthropic_call_log` (one row per successful `callClaude`) over bucketed `global_settings` columns / a materialized rollup / counters on existing tables. Keeps raw token counts available for re-costing after pricing changes, supports future per-scout/per-role drilldown with no schema work, and the breakdown RPC hot path (indexed `(app, fn_name, created_at desc)`) is fast enough that pre-aggregation isn't worth the staleness. 12-month prune via the existing monthly-reset cron.
- **Cap-edit consolidated to HQ Admin Settings (D2).** One editable cap surface (HQ Admin Settings writes `global_settings.anthropic_spend_cap_monthly_usd`); TS + VS Settings became read-only spend displays. The read-only per-function breakdown still renders on all three (app-filtered client-side: the RPC returns the full pool, the component drops other-app rows). HQ Admin Settings renders the grouped full-pool view; per-scout/per-role drilldown deferred (the schema FKs are the load-bearing piece).
- **`scout_id`/`role_id` at the `callClaude` wrapper (D3).** Both ride the options object so each caller threads them in one place; pre-create flows log null. Nullable FKs `ON DELETE SET NULL` so a deleted scout/role doesn't lose the cost record; partial indexes (`WHERE ... IS NOT NULL`).
- **Year window = calendar year (D11), explicit DROP before CREATE on the RPC signature change (D16).** `window_kind='year'` snaps to Jan 1 via `date_trunc` (matches the fiscal lens + the 12-month retention). The windowed RPC's migration `DROP FUNCTION IF EXISTS` the old single-arg signature before CREATE, because `CREATE OR REPLACE` on a different signature creates a sibling and PostgREST resolution would be ambiguous.

## Phase 5.14: Venue photo persistence (2026-05-28, complete)

Squash `4e67f12`. Two edge functions (`vs-generate-deck` + `vs-research-venues`), no migration, no frontend (storage-layer only). Per-phase narrative in `docs/v1-changelog.md` § 5.14. Uses the existing `venues.photos text[]` column + the public `venue_photos` bucket (both in `docs/schema.md`); 4 slots locked to match the deck template + the `vs_venue_photos` CHECK; no backfill of pre-5.14 venues (natural fill through normal workflow). All three `vs-research-venues` hq_pool INSERT paths seed `vs_venue_photos` from stored HQ photos (best-effort; copy failure = empty slots a producer can re-upload).

## Phase 5.13: Talent Scout review (2026-05-27, complete)

Squash `2393840`. 7 sub-phases collapsed. Per-phase narrative in `docs/v1-changelog.md` § 5.13.

### `.savebar` deleted; `.actionbar` is the single sticky-bar class

`.savebar` was a duplicate of `.actionbar` with built-in flex + padding. Removed and folded sub-rules into `.actionbar`; `StickySaveBar` renders `.actionbar` with an inner flex wrapper. One sticky-bar class HQ-wide eliminates the "which class do I use?" question and guarantees padding parity across HQ Core, VS, TS. (Superseded in 6.5 by the `.btn` actionbar convergence; see Phase 6.0 capability clusters D9.)

### `TIER_META` consolidated to a single definition in `scorecard.ts`

Two parallel definitions (CandidateDetail `token`+`label`; scorecard.ts `color`+`label`+`subtitle`) became one in `scorecard.ts`, with `color` renamed to `token` using canonical `.p-{token}` values. Three consumers, one definition, all on design-system tokens.

## Phase 5.12: Venue Scout review (2026-05-23 to 2026-05-27, complete)

Squash `ed81c38`. 28 sub-phases collapsed; 10 migrations + 9 edge functions touched. Per-sub-phase narrative in `docs/v1-changelog.md` § 5.12. Schema reshapes (`dedupe_meta` jsonb, `brief_data` 5-key string->string[] flip, `neighborhoods` nested under cities, `venue_types` DB-driven case-insensitive, `city_aliases`, `vs_candidate_venues.source` widened to `hq_pool`) are canon in `docs/schema.md`. UX/chrome canon (`.tbl` matrix decouple, back-crumb relocation to TopBar, `LookupListsCard`, `ScoutPageHeader` 3-zone primitive, `VenueMatrixRow` 7-column layout, honest server-driven loading progress, FinalReview->DeckPrep consolidation) lives in `docs/design-system.md`. Phase 5.12.8 (Brief client-logo web search) was CUT (low producer value). Still-binding cross-cutting decisions:

### Kickoff RPC pattern: advisory lock + grace window

Long-running pipelines that mutate state on entry are vulnerable to a check-then-write race (double-click, retry). The RPC closes it atomically: `pg_try_advisory_xact_lock` under a per-function namespace + same-transaction read-and-write of the kickoff timestamp + clear `pipeline_error`. The grace window MUST exceed the function's `WORK_TIMEOUT_MS` (hardened to `WORK_TIMEOUT_MS + 60_000`) so a refresh during in-flight work doesn't acquire a second kickoff. `vs_research_try_acquire_kickoff` + `vs_deck_try_acquire_kickoff` (SECURITY DEFINER, service_role only; see `conventions.md` § RPC posture). `vs-compile-summaries` still uses the old non-atomic kickoff (F007, tracked in `code-observations.md`).

### CAS guards on the final UPDATE

`Promise.race([work, timeout])` rejects on timeout but the losing `work()` is NOT cancelled: a slow Claude call can resolve later and overwrite the failure stamp with success. Every async pipeline's final success UPDATE must CAS on `current_step=<expected>` AND `pipeline_error IS NULL`. The kickoff RPC clears `pipeline_error` at acquisition; once `writeFailure` stamps non-null, the late-success UPDATE no-ops cleanly.

### Fit-rescue for HQ pool venues; three-gate auth on cross-scout functions

Pre-Phase-B rescue sends each fit-vetoed HQ city-pool venue to Claude via forced `submit_fit_evaluation`; keep-verdicts INSERT as `source='hq_pool'` (hard physical vetoes excluded, null about_venue skipped, cap 20, best-effort). Single-row edge functions that operate against open-authenticated VS tables enforce function-level gates (`vs-research-single-venue`: scout-scope predicate + source predicate + forward-only state, all 404-on-miss to avoid probe disclosure); the full gate-shape rule is canon in `docs/auth-model.md` § Function-level authorization gates.

### Carry-forwards still open

VS research-accuracy audit (hallucinations, tag verifiability, name/neighborhood canonicalization, URL accuracy); `vs-generate-deck` neighborhood auto-add into `public.neighborhoods` at deck-push time; System Prompts editor (deferred sub-phase). (The `.tbl` canon flip, Phase 5.14 photo persistence, and Phase 5.15 call-log infra carry-forwards all shipped.)

## Phase 5.11: UX/design-system audit + structural consistency (2026-05-23)

Frontend-only structural pass: chrome convergence + shared primitives, not redesign. Still-referenced decisions:

- **Detail-page editing stays dual-path.** Inline edits for high-frequency fields; the pencil button is the escape hatch to the full edit form for grouped fields, deletes, relationship rewrites. Intentional.
- **FilterBar `allowIsNot` is opt-in.** Default "is" only; surfaces needing a negative lifecycle filter (Tasks, Deliverables) opt in. New surfaces should not expose "is not" without a real workflow.
- **Capabilities is the vendor tag surface.** `vendors.tags` stays in DB but VendorEdit no longer exposes it; classification runs through Capabilities (managed lookup). Client/Person/Vendor detail tag arrays stay loaded-but-hidden (documented divergence, not reintroduced). Project Tags + Venue Features stay visible.
- **PersonDetail title-row pill routes to edit** because type derives from affiliation state; inline reassignment needs purpose-built clear-and-set UI. Venue-contact people get a sibling Associated Venues card (`combo-as-link`).
- **ProjectDetail Vendors keeps its add-Popover** (documented exception to the headbar `combo-as-link` standard-relationship-card pattern; discoverability is better there).
- **Venue Slide stays a header action** on VenueDetail + the Master Venue Deck Slide card on VenueEdit; don't fold into a generic Links card until Venue gains more distinct link types.

## Phase 5.10: `venues.about_venue` rename + AI About-paragraph generator (2026-05-21)

Squash one Netlify deploy. Per-phase narrative in `docs/v1-changelog.md` § 5.10. Still-binding decisions:

- **Breaking-rename coordination.** A column rename (`venues.notes` -> `venues.about_venue`, OID-preserving) breaks the deployed frontend's SELECTs (local dev hits live Supabase), so the migration apply + edge-function deploy + Netlify frontend deploy MUST land as one coordinated ship. The usual "additive migrations are safe to apply early" guidance does NOT cover breaking changes; held until push approval.
- **HQ generator is TOOL-LESS with its own evergreen prompt.** `hq-generate-venue-about` (first `callClaude('hq', ...)` consumer) runs tool-less with its own `ABOUT_VENUE_SYSTEM` (evergreen, brief-less) rather than lifting VS's brief-tailored `OVERVIEW_SYSTEM`/`OVERVIEW_TOOL`. Tool-less eliminates the `feedback_tool_choice_collapse` failure class outright (no forced tool to collapse). Includes `web_search` with `tool_choice: auto`; empty reply -> deterministic "name in city" stub.

## Phase 5.9: Bulk Import (2026-05-21)

Projects -> Vendors -> Venues importer trio on the 5.9.1 bulk-import primitive. Per-phase narrative in `docs/v1-changelog.md` § 5.9; the commit RPCs' full contracts are in `docs/schema.md` § Postgres functions. Still-binding decisions:

- **SECURITY DEFINER RPC is the source of atomicity.** PostgREST can't run a multi-statement transaction that rolls back together, so the whole commit lives in one `bulk_import_commit_<entity>(payload jsonb)` plpgsql function; any `RAISE` rolls everything back. Each entity gets its own RPC; the RPC owns the `bulk_import_sessions` + activity_log writes and signals via a returned `session_id` (the edge function skips its own session insert when present). Admin re-check reads `actor_id` from the payload (service-role invoke makes `auth.uid()` NULL).
- **EntityConfig registry owns resolution + payload shape.** Three optional hooks (`buildUnresolved`, `buildDedupe`, `buildCommitPayload`) + optional `validateRows`; the host stays generic, per-entity branches never grow.
- **`exclusive_vendor_ids` is NOT importable (load-bearing RPC change).** The prior RPC wrote `exclusive_vendor_ids` on dedupe-update, so a stopped-sending importer would wipe manually-curated values on every re-import. Set only on manual VenueEdit. Same shape: Projects dedupe-update REPLACES the `project_venues` roster (CSV authoritative) but never touches people-roster joins; venue contact joins are additive on update (never wiped) while `venue_venue_types` is replaced.
- **Importers create contact `people` rows.** Vendor/Venue importers write a `people` row (`affiliation_type` = Vendor/Venue) so the Primary Contact picker resolves; dedupe is scoped to the same parent (vendor email-first, venue name-first), never global. Event Day Rate seeds the append-only `venue_rate_history` (insert only when amount `IS DISTINCT FROM` the current most-recent).

## Phase 5.8: HQ v1 release + security audit + cleanup (2026-05-19)

Per-phase narrative in `docs/v1-changelog.md` § 5.8. The RLS-helper EXECUTE carve-out + the intentional advisor hits are canon in `docs/auth-model.md` § Intentional SECURITY DEFINER advisor warnings. Standing do-not-touch invariants:

- **Open-authenticated RLS posture was the HQ Core baseline** (single trusted Google-OAuth tenant); 54 `rls_policy_always_true` advisor warnings are intentional, not drift. **Superseded in 5.16.0:** every former `USING(true)` HQ Core policy now gates on `is_active_member()` (pending is blocked), so the "open to any authenticated" framing is historical; see `auth-model.md` for the live posture.
- **RLS helper EXECUTE carve-out.** `is_admin()`, `is_producer_or_admin()`, `current_user_role()` MUST stay EXECUTE-callable by `authenticated` (they run inside RLS predicates; SECURITY DEFINER blocks SQL inlining so every RLS caller needs EXECUTE). The 5.8.5 REVOKE-without-re-GRANT emptied production TS open-roles within seconds. Before REVOKE'ing EXECUTE on any SECURITY DEFINER function, grep for RLS callers (`feedback_revoke_execute_check_rls_callers`).
- **`rls_auto_enable()` event trigger (do not drop).** Wired to `ensure_rls`, it `ALTER TABLE ENABLE ROW LEVEL SECURITY` on every newly-created `public.*` table. Load-bearing safety net for the RLS baseline; a 5.8.5 DROP attempt failed on a dependency error. Do not drop.
- **`tmp_5_8_5_probe` pgsodium key (accept-risk).** A never-used probe key remains in `pgsodium.valid_key`; pgsodium restricts DELETE by design (append-only), it's functionally inert. Leave in place.

## Phase 5.7: HQ Core UI overhaul (2026-05-18)

Per-phase narrative in `docs/v1-changelog.md` § 5.7. Still-binding decisions:

- **Wiki images: private bucket + 1-year signed URLs** (keeps confidentiality consistent with `wiki_pages` RLS). TTL tradeoff: after ~365 days an unedited page's `<img>` 403s. Acceptable for v1; carry-forward if it bites is a render-time URL-swap (store `data-storage-path`, mint fresh URL on mount). Bucket policy in `docs/auth-model.md`.
- **Diff-on-save image cleanup (no orphan-image cron).** On save, diff old vs new body HTML and `storage.remove()` departed paths; on page-delete sweep all embedded paths; on editor-cancel sweep this-session uploads. A hard refresh mid-edit leaves a small orphan window (acceptable); a nightly diff job is the carry-forward if it grows.

## Phase 5.5: Notifications + Activity Feed + Search (2026-05-16)

Per-phase narrative in `docs/v1-changelog.md` § 5.5. Still-binding decision:

- **`notifications-dispatch` is internal-only (no user-JWT path).** A security-audit catch: `requireInternalOrUserAuth` would let any signed-in user POST a crafted `recipient_user_ids` to spoof in-app notifications + trigger Slack DMs to admins. The function reads with service role, so authorization is replaced by an internal-secret gate at entry; all legitimate callers (triggers, `handle_new_user`, `hq-cron-*`) already send `x-internal-secret`. The durable `user_pending` in-app row is written inline by `handle_new_user` BEFORE dispatch (which special-cases the event and skips the in-app insert) so the most important signal lands even if dispatch 500s. See `docs/edge-functions.md`.

## Phase 5.4: Wiki + Account Logins + Users + Settings (2026-05-16)

Per-phase narrative in `docs/v1-changelog.md` § 5.4. Still-binding decisions:

- **ID-swap on pre-provisioned users.** Team Add inserts a `public.users` row for a teammate who hasn't signed in; the shipped FK `users.id REFERENCES auth.users(id)` blocked that, so the FK was dropped and `handle_new_user` performs an idempotent id-swap on first sign-in (matching id is a no-op; matching email with a different id triggers swap; no match -> fresh pending insert + admin notification). Tradeoff: hard delete in `auth.users` no longer cascades (Mirror rarely hard-deletes). The swap block is load-bearing; see `docs/auth-model.md` § Phase 5.8.8 hardening notes.
- **Credentials stored plaintext-at-rest (intentional).** Access control is RLS-enforced (Freelance blocked, admin write, standard+admin read), Supabase encrypts at rest at the storage layer, the reveal-and-copy UX is convenience not a security boundary, and the data is operational team credentials, not user secrets. Application-level encryption rejected (client keys = fresh problem each session; server endpoint = latency + RLS duplication). Matches the internal-team-password-vault baseline.
- **Wiki `page_type` enum + seeded special pages.** `prose | team_directory | vendors_glance | account_logins`; the three special types render hardcoded components and are migration-seeded (can't be created/deleted from UI) so Calendar/Logins/Vendors pages can rely on their slugs existing. `mirror_holidays` moved from a hardcoded constant to a table + CRUD editor so admins add 2027+ holidays without a code change.

## Phase 5.3: Calendar + Outlook (2026-05-16)

Per-phase narrative in `docs/v1-changelog.md` § 5.3. Status-color mapping is canon in `docs/design-system.md` § 5b. Still-binding decisions:

- **Promote vs Unlink vs Delete are three distinct actions.** Promote to Project (RPC creates a `projects` row, sets `linked_project_id`); Unlink (clears `linked_project_id` only; project stays); Delete entry (removes `outlook_entries`; linked project stays unlinked, FK is `ON DELETE SET NULL`). Separate so a producer can detach a speculative entry from a real project without nuking either.
- **`outlook_entries.shared_with_team` gates Calendar visibility, not Outlook-page visibility.** The Outlook page is admin-only; the shared toggle controls whether an entry surfaces on the unified Calendar for non-admins (non-clickable banner for standard/freelance, clickable for admins). Locked non-clickable over hide-from-standard so producers can see "team has a planning event that week" without reaching the admin-only page.
- **Per-user Calendar visibility persists via an implicit `saved_views` row** (`entity_type='calendar'`, `is_default=true`, one row per user, no naming UI).

## Phase 5.2: HQ Core databases + entity trio + clients-vendors split (2026-05-16)

Per-phase narrative in `docs/v1-changelog.md` § 5.2. The enum reshapes (project_status 14-value, task_status, deliverable_status), the Deliverables table, the `clients -> organizations -> vendors` rename lineage (policy identifiers stay `clients_*` by OID), and the people/venues schema (`venue_venue_types` join, `venue_rate_history`, multi-affiliation) are canon in `docs/schema.md`. The wireframe-canonical-class-name binding rule (the 5.2.1 parallel-Tailwind revision that cost a full rebuild) is canon in `docs/design-system.md` § Wireframe-canonical class names. Still-binding cross-cutting decisions:

- **`saved_views` is the one HQ Core table with per-user RLS** (`user_id = auth.uid()`), not the shared open-authenticated posture, because saved views are personal not team state. `is_default` per `(user_id, entity_type)` enforced in app via a transactional clear-then-set (no DB partial unique index, which a multi-row write would have to dodge mid-flight).
- **Rail = single Tools group + tool-app variant (route-based).** Tools (Standard + Admin) collapsed into one ordered list with per-item `adminOnly?`; the tool-app variant is detected via `pathname.startsWith('/talent-scout' | '/venue-scout')`, not state. (Extended in 5.12.12 + 5.13.1; current rail canon in `design-system.md` § Left rail.)

## Phase 4 cutover + port plan locked decisions

The VS port plan doc was deleted in the 5.8.3 audit; these six decisions (confirmed 2026-05-11) and the deep 4.x-port implementation history are preserved here as the canonical record. Most 4.x-port implementation detail was superseded by the Phase 5.12 VS review; the per-sub-phase narrative lives in `docs/v1-changelog.md` § Phase 4 + git. Still-binding port decisions:

- **Single-round sourcing per scout.** One scout, one sourcing flow; no `vs_sourcing_rounds` table; re-research via Start Over.
- **Brief inline on `vs_scouts`.** Named columns for structured fields, `brief_data jsonb` for flexible additional fields.
- **`EdgeRuntime.waitUntil` + Realtime for the loading pages.** Researching/Compiling/Generating subscribe to `vs_scouts.current_step` via Realtime instead of awaiting synchronously; edge functions return `scout_id` immediately. Requires `vs_scouts` in `supabase_realtime` with REPLICA IDENTITY FULL. The only place the port diverges from VS Pro.
- **`current_step` state machine is canonical workflow state** (10 values incl. the Revision-added `brief`); `stepToRoute()` drives every page's continue logic.
- **Deck history as `vs_scouts.generated_decks` jsonb array** (no separate `vs_pitch_decks` table; deck history is small, the access pattern is "all decks for this scout").
- **VS RLS open to all authenticated users** (`FOR ALL TO authenticated USING(true) WITH CHECK(true)` per `vs_*` table; collaborative agency-wide workflow). **Superseded in 5.16.0:** now gates on `is_active_member()`; see `docs/auth-model.md`.

### Still-binding AI-surface patterns from the VS port (4.5 - 4.10.x)

These hardened patterns survive into the current pipeline (most are now also enforced in the Phase 5.12 functions + `edge-functions.md`):

- **`feedback_tool_choice_collapse` is the governing rule for AI output quality.** Forced `tool_choice` + server-side web_search collapses output to empty/minimal tool calls; the levers are schema/field descriptions + maxLength + post-emission sanitization, NEVER editing the frozen SYSTEM prompts. Drop forced `tool_choice` to `auto` when collapse is observed. Post-emission gates that exist because of this: `sanitizeWebsiteUrl` + HEAD-validation (rejects fabricated listing URLs), `stripPlaceholders`/`isPlaceholderString` (Claude fills `<UNKNOWN>`/`TBD` to satisfy minItems), `sanitizeTagShape`, URL extraction fallback (`findVenueWebsite`).
- **`pause_turn` continuation in `callClaude`** (server-tool loop can return `stop_reason=pause_turn`; the wrapper sends a continuation request, capped at `MAX_PAUSE_CONTINUATIONS=1`). See `docs/edge-functions.md` § callClaude.
- **`writeFailure` CAS guards** prevent a late-failing parallel invocation from overwriting an earlier success (CAS on `current_step=<expected_pre_success_step>` on the failure UPDATE). This is the 5.12 "CAS guards on final UPDATE" rule's origin.
- **`pipeline_error` is the single AI-pipeline failure channel** (`<CODE>: <message>`; Researching/Compiling/Generating subscribe to one column; renamed from `research_error` at 4.10.3). Failure leaves `current_step` at the pre-success step so a producer can re-trigger without walking back through the funnel.
- **`frontend venueTypes.ts` mirrors `_shared/venueTypes.ts` in lock-step** (any change to the shared exports touches both files in the same commit; drift mismatches type pills between the matrix UI and AI/sheet data). Also a `conventions.md` rule.
- **`getGoogleAccessToken` (no impersonation) for Drive + Slides** in `vs-generate-deck`; cache keyed by `${impersonateUser ?? ""}|${sortedScopes}` so the Gmail and Drive+Slides tokens coexist. Deck name uses a hyphen, not an em dash. See `docs/auth-model.md` § Google service account.

## Talent Scout port (Phase 3): locked decisions

Per-phase narrative in `docs/v1-changelog.md` § Phase 3. Cron cadences + watchdog thresholds are canon in `docs/cron-jobs.md`; the self-invocation auth pattern is canon in `docs/auth-model.md` § Edge Function self-invocation auth; the `callClaude` wrapper is canon in `docs/edge-functions.md`. Still-binding decisions:

- **`promote` -> `interview` enum rename + status-bucket sort.** `ts_candidate_status` = (consider, interview, reject, fast_track, auto_rejected). CandidateTable sorts by status bucket first (Interview -> Fast-Track -> Consider active; Rejected -> Auto-Rejected collapsible), then by user column.
- **Inline-mutation components await the DB write before calling `onChange`/refetch** (`StatusDropdown` is the reference). Calling `onChange` first races the write and leaves the UI one click behind. The HQ-wide rule; also in `conventions.md`.
- **Re-eval history kept** in the separate `ts_evaluations` table (every re-eval INSERTs, latest mirrors onto `ts_candidates`); bulk re-eval is the one `overwrite_history` exception (implies prompt/scorecard changed). Bulk re-eval is role-scoped (`reeval_*` columns on `ts_roles`); PullDetail's round-scoped re-eval fans out `ts-evaluate-candidate` at concurrency=6 (the unbounded fan-out in CandidateTable is F009, tracked in `code-observations.md`).
- **`manually_reviewed` one-way flip** locks a candidate against future re-evals updating its status (score/strengths/gaps still update); the redundant `auto_rejected` enum value is deprecated (kept; new writes never use it).
- **Referral identity = the original applicant**, `referrer_email` captures the forwarding manager (`is_referral=true`); eval is blind to referral status (electric-blue ReferralPill, no scoring lift). The forward parser walks every chain segment and picks the deepest non-`@mirrornyc.com` sender; manager commentary is captured into `internal_notes` and folded into the first eval as verified context. `mirrornyc.com` is in `BLOCKED_PORTFOLIO_DOMAINS` (manager signatures embed it).
- **Refinement is a separate manual step** (the "Process scorecard" / "Approve & lock" button morph), not auto-fired, because a user is usually mid-edit-stream and the call costs spend; `mergeRefinedIntoOriginal` re-applies user scoring decisions regardless of model output (trust the model only for the field you asked it to refine).
- **Two packet edge functions share `_shared/packetRender.ts`** (`ts-packet-generate` round-scoped + `ts-final-review-packet` review-scoped; consolidating would mean a 200-line if/else). HQ reads attachments from Storage (persisted at pull time) instead of re-fetching Gmail, and emails the PDF via the service account; PDFs keep VS Pro's `#ef5b5b` coral (the dustier `#BE4E44` reads dim on print).

## Phase 2 (schema + auth)

- **`handle_new_user` Postgres trigger replaces the planned `auth-on-signup` Edge Function** (runs with service-role privileges, atomic with the `auth.users` insert, no cold-start). The function name is reserved in case extra signup-time work is needed. See `docs/auth-model.md` + `docs/schema.md`.
- **Project security defaults: Auto-expose OFF, Auto-RLS ON.** Every new table requires explicit `GRANT` to `authenticated` + `service_role`, forcing a review of which roles can hit the Data API at all, separate from RLS. See `docs/conventions.md`.

## Open

- **Project status enum trim.** The current 14 values may consolidate; revisit in a future polish phase (no longer Phase-5-gated).
- **TS data extraction** (future cross-platform; not blocking). Plan: re-create active roles via Gmail re-pull, preserve closed roles as packet-PDF archives. Tracked as a post-v1.0 item in `docs/roadmap.md`.
