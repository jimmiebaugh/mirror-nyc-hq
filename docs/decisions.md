# Decisions

Architectural decisions worth preserving with their rationale. Newest at the top within each section.

## Phase 4.8.1-port (Deck Prep + googleServiceAccount infra)

### Phase 4.8-port split into two passes (4.8.1 frontend + infra, 4.8.2 generate flow)

Combined 4.8-port scope was ~1,000 lines of source across DeckPrep + Generating + `vs-generate-deck` (the largest single function in the port). Splitting isolates the Google Slides population logic for its own review cycle, lets the `googleServiceAccount` cherry-pick land independently of slide-template complexity, and lets 4.8.2 wait on secrets verification (`GOOGLE_TEMPLATE_FILE_ID`, `GOOGLE_OUTPUT_FOLDER_ID`) without blocking 4.8.1. 4.8.1-port ships DeckPrep + the shared service-account helper + the gmailServiceAccount delegation refactor. 4.8.2-port ships Generating + `vs-generate-deck` + the four new ErrorStateStub keys.

### `_shared/googleServiceAccount.ts` cherry-picked from failed-attempt main `be30168`

The failed-attempt Phase 4.6 already built the generic Google access-token helper with the exact shape the port needs: module-level cache keyed by `${impersonateUser ?? ""}|${sortedScopes}`, optional `impersonateUser` for domain-wide-delegation flows, supports both Gmail (impersonates `jobs@mirrornyc.com`) and Drive + Slides (no impersonation; service account owns the API call). Rewriting from scratch would produce the same file. Cherry-picked verbatim with header comment refreshed to reference Phase 4.8.1-port and em-dashes swapped to comma per voice rule. No behavioral changes.

### `gmailServiceAccount.ts` refactored to delegate

Pre-4.8.1 file was ~130 lines with its own copy of `loadServiceAccountKey` / `importRsaPrivateKey` / `signJwt` / `base64Url*` helpers and a private token cache. Post-refactor: ~30 lines. Public API (`getGmailAccessToken(): Promise<string>`) preserved exactly; all four callers (`ts-pull-candidates`, `ts-evaluate-candidate`, `_shared/sendEmail.ts`, `_shared/packetRender.ts`) keep their existing import. Internal implementation delegates to `getGoogleAccessToken(SCOPES, { impersonateUser: 'jobs@mirrornyc.com' })`. Smoke-tested against TS pull/evaluate to confirm no regression before squash.

### DeckPrep `current_step` writes deferred to server-side (vs-generate-deck, 4.8.2-port)

VS Pro's DeckPrep has a stub `current_step='deck_generated'` write inside an unreachable `try` block; the live flow already deferred to server-side. Port matches: 4.8.1-port frontend only writes `deck_order` + `include_in_deck` flags. `current_step='completed'` is written by `vs-generate-deck` on success (lands in 4.8.2-port), parallel to 4.5-port and 4.7.2-port EdgeRuntime.waitUntil patterns where server-side state transitions are atomic with the actual work.

## Phase 4.7.2-port (Compiling + vs-compile-summaries)

### Reuse `vs_scouts.research_error` column for compile errors

Adding a `compile_error` column would split the AI-pipeline failure channel into two physically-separate state machines for what is conceptually a single producer-facing concern ("something in the AI pipeline went wrong"). Keeping one channel means both Researching and Compiling pages subscribe to the same Realtime payload shape, ErrorStateStub keys (`research-timeout`, `compile-failed`) co-locate, and Scout Index can render a single "had a problem" indicator without joining two columns. The column rename to `pipeline_error` (more accurately describing the dual usage) is deferred to cutover doc sweep or 4.9-port polish; renaming is cheap, splitting later is not.

### Compile timeout raised to 180 seconds (vs 4.5-port research's 120)

Compile arithmetic is per-venue, not per-call. 5 pitched venues with all manual rows triggers up to 10 sequential Claude calls (Pass 1 fill + Pass 2 overview each). At ~15 seconds per call, that's 150s of work; ceiling at 180s gives a 30s buffer. Research is a single Claude call regardless of venue count (the tool returns a batched array), so its 120s ceiling stays appropriate.

### Two-pass compile-summaries through `callClaude` (first multi-tool-choice consumer)

VS Pro's compile-summaries was the first function in the source repo with two distinct `tool_choice`-forced tools in a single function (`fill_venue` for Pass 1, `write_overview` for Pass 2). HQ's port is the first port-side function with that shape; the `callClaude` wrapper already supports per-call `tools` + `tool_choice` so no wrapper changes needed. Pattern documented inline in `vs-compile-summaries/index.ts` for the next multi-tool consumer.

### Notes flow collapsed: inline `vs_candidate_venues.notes` (vs VS Pro's separate `venue_notes` table query)

VS Pro reads `from("venue_notes").select(...)` separately to build a `noteMap`. 4.3-port already inlined producer notes into `vs_candidate_venues.notes`; vs-compile-summaries's venues query selects `notes` directly. Both Pass 1 and Pass 2 user messages substitute `Producer notes: ${v.notes ?? "(none)"}` from the inline field. Saves one round-trip per compile call and avoids the extra `notes_by_venue_id` mapping step.

### `vs-compile-summaries` payload simplified from `{ project_id, venue_ids }` to `{ scout_id }`

VS Pro requires the page to fetch pitched venue IDs first and pass them in. Port flips: the function queries pitched venues itself via `eq("scout_id", scout_id).eq("pitched", true)`. Smaller payload, matches the rest of the port-side functions (`vs-parse-brief`, `vs-research-venues` both take `{ scout_id }` only), and centralizes "which venues to compile" in one place (server-side, atomic with the load) instead of split between page and function. Pitched-venues query is fast (indexed on `(scout_id, pitched)` via the implicit FK + boolean column).

### Testing `claude-sonnet-4-6` on compile-summaries (independent test from 4.5-port research-venues)

Same posture as research-venues: take the wrapper default and watch the diagnostic log for the collapse signature. Different prompts may behave differently — research's `submit_research` with `web_search` had a known May 11 collapse pattern (out<200 + server_tool_uses=0); compile's `fill_venue` and `write_overview` are pure text-tool flows with no server tools, so the signal narrows to `out<200`. Pivot procedure to `claude-sonnet-4-5` is inline in the function. The memory note `project_sourcing_model_pin` covers the failed-attempt `vs-start-sourcing` and does NOT carry over to port-side functions.

## Phase 4.7.1-port (Review + PhotoUploadModal + Shortlist photo unstub)

### Phase 4.7 split into two passes (4.7.1 frontend, 4.7.2 backend)

The combined 4.7-port scope (Review + PhotoUploadModal + storage bucket + Shortlist unstub + Compiling page + `vs-compile-summaries` edge function + `compile-failed` error key) was ~2,000+ lines across 4 artifacts. Splitting into 4.7.1 (frontend + storage) and 4.7.2 (compile flow) gives each pass a 4.6-port-sized scope, isolated code-reviewer cycles, smaller blast radius if the storage bucket migration needs revision, and keeps PhotoUploadModal complexity ("most complex single component in the port" per port plan) in its own pass. After 4.7.1, Review's Confirm + Compile Deck button writes `current_step='compiling'` and navigates to `/sourcing/compiling`, which 404s until 4.7.2-port. Same intentional 404 window pattern as 4.2→4.3, 4.3→4.4, 4.4→4.5, 4.5→4.6, 4.6→4.7.

### `vs_venue_photos` bucket private + signed URLs (renamed from VS Pro `venue-photos` public)

VS Pro's public `venue-photos` bucket would expose deck photos to anyone with the URL. HQ's `vs_venue_photos` bucket is private (`storage.buckets.public = false`) with storage RLS gated on `is_producer_or_admin()`, parallel to `sourcing_sheets` + `briefs`. Display reads go through `supabase.storage.from("vs_venue_photos").createSignedUrl(path, 3600)` (1-hour TTL); URLs regenerate on every Review mount and every PhotoUploadModal open. Privacy + bucket rename is the locked port-plan § 2 decision; HQ Core's existing public `venue_photos` bucket (used by the master `venues` table) stays for HQ Core reads downstream.

### Storage path format `${scoutId}/${candidateVenueId}/slot-${N}-${timestamp}.${ext}`

Lifted from VS Pro verbatim (hyphen + timestamp). The 4.1-port `docs/schema.md` spec read `slot_${N}.${ext}` (underscore, no timestamp) as a placeholder; this sub-phase updates the doc to the landed format. The timestamp cache-busts when a producer re-uploads to a slot whose old storage object was just deleted in the same save (otherwise the CDN can serve the stale image for that path's lifetime). Scout-id and candidate-venue-id segments rename from VS Pro's `${projectId}/${venueId}` per the HQ table rename.

### HQ canonical `Field` created at `src/components/ui/Field.tsx`

VS Pro's Review.tsx defined a small inline `Field` (10px uppercase muted-foreground label above child). The spec locks the inline definition gets dropped in favor of an HQ canonical primitive. Created `src/components/ui/Field.tsx` with that compact shape. Deliberately distinct from the heavier page-form Field shape used inline in `Brief`, `NewScout`, `NewRoleDetails`, `RoleSettings` (13px font-mono `text-primary` Label primitive). Those pages keep their inline definitions; consolidating both into one canonical isn't 4.7.1-port's job and the styles diverge enough that a single component would need a `variant` prop.

### PhotoSlot renders actual signed URL when `hasPhoto`

VS Pro's Review.tsx PhotoSlot at line 272 hardcoded the placeholder for both states (`backgroundImage: hasPhoto ? "url(/mirror-placeholder.jpg)" : "url(/mirror-placeholder.jpg)"`); appears to be a stub awaiting real signed-URL wiring. Port fixes it: when `hasPhoto && photoUrl`, render `url(${photoUrl})`. Producers expect to see their photos at a glance on Review — a placeholder-for-everything makes the page useless for the "confirm photos" task. `photoUrls` state is populated on mount + refreshed via `refreshVenuePhotos(activeVenueId)` after PhotoUploadModal save.

### Shortlist photo column unstub: real query + real modal open

4.6-port stubbed `photoCounts` to always 0 and the click handler to a toast. 4.7.1-port replaces the stub query with a real `select("candidate_venue_id").in(...)` against `vs_venue_photos`, replaces the toast with `setActiveVenue(v) + setPhotosOpen(true)`, and mounts `<PhotoUploadModal />` at the bottom alongside `<NotesModal />`. The button state machine (Locked / + Upload / ✓ Complete) stays verbatim from 4.6-port.

## Phase 4.6-port (Sourcing Report + Shortlist + matrix primitives)

### Frontend `venueTypes.ts` mirror landed; lock-step with `_shared/venueTypes.ts`

Port plan § 6 primed the server-side `_shared/venueTypes.ts` in Phase 4.1-port ahead of consumers (`vs-parse-sheet` at 4.4-port and `vs-research-venues` at 4.5-port). 4.6-port lands the frontend mirror at `src/lib/venue-scout/venueTypes.ts` for the matrix. Same `CANONICAL_TYPES`, `TYPE_STYLES`, `canonicalizeType`, `canonicalizeMultiType`, `parseTypes`, `sanitizeWebsiteUrl` exports; any change touches both files in the same commit. Header comments on both files flag the rule. Drift produces mismatched venue type pills between the matrix UI and the AI / sheet source data.

### Notes table dropped; notes inline on `vs_candidate_venues.notes`

VS Pro carries a separate `venue_notes` table with a row per venue and a separate query at mount. The port collapses it into a single nullable `notes text` column on `vs_candidate_venues` (already on schema as of 4.1-port). Saves a round-trip on the matrix page mount, simplifies the NotesModal save path (single UPDATE instead of an UPSERT against a child table), and matches the inline-on-parent pattern HQ uses for Talent Scout `internal_notes`.

### Photo upload column stubbed for visual parity

VS Pro's `UploadPhotosButton` renders three states (Locked / + Upload / ✓ Complete) gated on `pitched` and a count from `venue_photos`. 4.6-port lifts the button verbatim but always passes `count=0` and routes the click handler to a toast pointing to Phase 4.7-port. Producer sees the full column + state machine so the Shortlist page reads complete; the upload modal + `vs_venue_photos` reads land in 4.7-port. Alternative was to hide the column entirely until 4.7, which would have masked the visual layout and made the column-width audit harder.

### Matrix renders inside AppShell's `max-w-7xl` container with horizontal scroll

VS Pro's matrix wrappers in `max-w-[1860px]` page-level container; the table itself is `min-w-[1740px]` and scrolls horizontally inside its own `overflow-x-auto` wrapper. HQ's AppShell scopes every authenticated route to `max-w-7xl` (1280px), so the matrix scrolls horizontally on most viewports rather than breaking out of the AppShell container. Tradeoff acknowledged: less optimal on wide monitors than VS Pro's layout, but stays inside the AppShell idiom (same as every other HQ surface) and avoids negative-margin escapes. Revisit at the 4.10-port polish pass if it actually bites.

### Inline header pattern (no `PageHeader` component lift)

VS Pro uses a `PageHeader` component with `crumbs`, `label`, `title`, `description`, `actions` props. HQ port has inlined the equivalent pattern on every Venue Scout surface (Phase 4.2 through 4.5). 4.6-port stays consistent: `crumb` link + eyebrow + `h-page` heading + right-aligned counter + optional description, all inline. Extraction to a shared `PageHeader` component is a candidate for a doc-only cleanup commit once enough surfaces have shipped that the pattern is stable.

### Type-pill palette lifted verbatim from VS Pro (no HQ token substitution)

VS Pro's per-type `bg-[rgba(181,133,136,0.18)] text-[#D89BA0]`-style rgba palette is an intentional desaturated brand-context color set with one tone per venue type. HQ design tokens don't define equivalent type-specific accents and substituting `text-foreground / muted-foreground` would lose the at-a-glance type signal. Lift the literal rgba values into `TYPE_STYLES` and keep them out of the HQ token chain. Same rationale applies to the rank-tier hex colors (`#4ade80`, `#f59e0b`, `#ef4444`, `#555`): VS Pro picked them deliberately and they're the same colors HQ uses inline elsewhere (`tier-badge--3` etc.), so leave them as literals in `RANK_TEXT` / `RANK_BAR`.

### Matrix column-header strip uses `bg-surface` (opaque), not `bg-secondary/30`

4.2-port (ScoutIndex) and 4.4-port (SheetUpload) both use `bg-secondary/30` for their list-view header strips because no sticky columns are in play and the translucent backdrop reads cleanly over `bg-background`. The matrix has sticky col1 + col2 headers, so the 30% alpha lets horizontally-scrolled column content bleed THROUGH the sticky cells, producing a visual smear. Surfaced by code-reviewer cold pass on `272a077`. Swapped to opaque `bg-surface` (`0 0% 4%`), which also matches VS Pro `--bg-elevated` (`0 0% 4%`) byte-for-byte. Header strip now reads slightly darker than the matrix body (`bg-surface-alt` = `0 0% 8%`), preserving VS Pro's intended elevation contrast.

### `Shortlist.debounceSave` widens its patch type and splits `key_features` eagerly

The manual-row `<input>` emits a raw delimited string ("warehouse, gallery, …") on each keystroke. The original implementation cast that string into the `key_features: string[] | null` slot via `as unknown as string[]`, leaving a string in the in-memory Venue. Surfaced by code-reviewer as a type-lie that would crash any consumer reading `v.key_features` as an array (`.join` / `.map` on string vs. array). Fix: `debounceSave` now accepts a `VenuePatch` union (`key_features?: string[] | string | null`) and normalizes to an array BEFORE writing state, so the Venue type stays honest and the eventual DB UPDATE writes the array directly (the previous deferred split inside the setTimeout became dead code).

### Alignment pills use Tailwind `green-400` / `amber-400` instead of `--success` / `--warning` tokens

VS Pro reads `bg-[hsl(var(--success))]/15` and `bg-[hsl(var(--warning))]/13` on the Alignment column pills. HQ defines `--success` (matches: 4ade80) but uses `--warn`, not `--warning`. Rather than introduce a `--warning` alias or two-track the pill backgrounds across HQ files, swap both pills to fixed Tailwind palette colors that resolve to the same hex (green-400 = #4ade80, amber-400 = #f59e0b). One-line substitution; no token-naming follow-up needed.

### Shortlist sync trigger simplified to one condition

The failed-attempt trigger fired on `(shortlisted false→true) OR (added_manually=true AND research_status='complete')`. Port schema doesn't carry `added_manually` (collapsed into `source='manual'`) or `research_status`. The 4.6-port re-introduction fires only on `shortlisted false→true`. Manual venues added on Shortlist enter with `shortlisted=false, source='manual'`; the page's `v.shortlisted || v.source==='manual'` filter makes them visible regardless. If a producer pitches a manual venue but never toggles shortlisted, the sync trigger never fires and no HQ `venues` row is created — known gap, acceptable for 4.6-port. A future migration could extend the trigger to also fire on `pitched false→true` or on `source='manual'` INSERT, but that's out of scope here.

### Manual venue add row inserts `shortlisted: false`

VS Pro's behavior. The page filter `v.shortlisted || v.source==='manual'` makes manual rows visible on Shortlist regardless, so auto-shortlisting them wouldn't change visibility — it would just fire the sync trigger on insert before the producer has confirmed details. Keeping `shortlisted=false` matches VS Pro and defers the sync to an explicit producer action (toggling shortlist back on `SourcingReport`, or extending the trigger later per the prior decision).

## Phase 4.5-port (Researching + vs-research-venues)

### `EdgeRuntime.waitUntil` + Realtime replaces VS Pro's sync-await

Port plan § 8.3 calls this out. VS Pro's Researching page awaits a synchronous fetch on `research-venues` for 30 to 90 seconds before navigating. HQ port flips the handshake: `vs-research-venues` returns 200 immediately, the AI work runs inside `EdgeRuntime.waitUntil`, and the Researching page Realtime-subscribes to `vs_scouts` (`REPLICA IDENTITY FULL` was set on the table during 4.1-port) plus 3-second polling fallback. Faster perceived UX, graceful navigation-away (kicking off then closing the tab still completes the research). Same pattern as `ts-final-review` + `FinalReviewLoading`.

### `vs_scouts.research_error text` column added for the EdgeRuntime.waitUntil failure channel

Because the page no longer reads failure off the HTTP response, the function needs a persistent channel to signal "research failed". `status='failed'` alone doesn't carry a message; `research_error text` (nullable) does. Function clears it at kickoff so a retry from a prior failure starts clean, then writes the message on any error path. The Researching page navigates to `/sourcing/error/research-timeout` (the existing 4.4-port stub keyspace) on non-null `research_error` + `status='failed'`.

### Testing `claude-sonnet-4-6` (wrapper default) on `vs-research-venues`

Existing memory note `project_sourcing_model_pin` pins the failed-attempt `vs-start-sourcing` function to `claude-sonnet-4-5` after the 2026-05-11 `web_search` degradation. The port-side `vs-research-venues` is a NEW function name (does not slot-replace anything) and we're starting fresh on `claude-sonnet-4-6`. Diagnostic log line on every call captures `input_tokens`, `output_tokens`, and `server_tool_use` block count: the collapse signature is `out<200 AND server_tool_uses=0`. If the first real round in production reproduces that, the pivot procedure is documented in `supabase/functions/vs-research-venues/index.ts` (single-line `model: "claude-sonnet-4-5"` override on the `callClaude` call) and the memory note gets updated to add `vs-research-venues` alongside `vs-start-sourcing`.

### URL quality lever stays off the SYSTEM prompt

Per memory rule `feedback_tool_choice_collapse`: per-item gating in SYSTEM prompts (or `minItems` constraints on the array under forced `tool_choice`) collapses output. The SYSTEM string is lifted verbatim from VS Pro: the type-constraint paragraph and the listing-DB callout are unchanged. URL quality is enforced by two deterministic post-emission gates: (a) the `website_url` schema description nudge (positive-only with concrete examples; no forbidden-URL list), and (b) `sanitizeWebsiteUrl` from `_shared/venueTypes.ts` rejecting search pages + listing-DB homepages while letting deep links through. Same two-gate chain the failed-attempt URL-quality hot patch settled on.

### Idempotency via `brief_data.research_started_at` 90-second grace window

`EdgeRuntime.waitUntil` runs after the response, which means a page hard-refresh while research is in flight will fire the kickoff invoke again. Without a guard, that doubles the Anthropic spend and INSERTs duplicates. Function checks two conditions before doing work: (a) `current_step !== 'researching'` skips (page already moved on), and (b) `brief_data.research_started_at` less than 90 seconds old skips (kickoff still in flight). Otherwise it stamps `research_started_at = now()` and proceeds. 90 seconds is slightly longer than typical Anthropic response time so a normal completion clears the window naturally.

### 120-second hard ceiling on Claude work

`Promise.race(callClaude, timeout)` inside `work`. If the call hangs (network stall, server-side issue), writes `status='failed' + research_error='timed out after 120s'` instead of leaving the page spinning forever. Defense-in-depth; the AI typically returns in 60 to 90 seconds.

### Empty sanitized result writes failure (does not silently advance)

After `canonicalizeType` + `sanitizeWebsiteUrl` + nameless-row filter, if `cleanVenues.length === 0` we treat it as a research failure (`research_error='AI returned no usable venues. Try again.'`) rather than INSERTing zero rows and flipping to `sourcing_report`. Surfaces the issue to the producer; silent zero-result would leave them on a Sourcing Report with no candidates and no obvious "what now".

### `vs_scouts.status='in_progress'` on research success

VS Pro's `projects.status` semantics were undefined; HQ port locks them down. `draft` (initial) goes to `in_progress` (research complete, in the AI funnel through deck generation), then to `complete` (4.8-port deck generated) or `failed` (any AI pipeline error). The ScoutIndex pill (4.2-port) reads from this column; writing `in_progress` on research success lets the pill distinguish "started" from "researched" at a glance.

### `vs-research-venues` is a NEW function name (does NOT slot-replace `vs-start-sourcing`)

VS Pro's research function was named `research-venues`; the failed-attempt HQ function is named `vs-start-sourcing`. The port plan's renames put the new function at `vs-research-venues`, which is unused. After 4.5-port deploys, `vs-start-sourcing` stays on the cutover deletion list (different from how 4.3-port / 4.4-port slot-replaced existing functions).

## Phase 4.4-port (Sheet Prompt + Sheet Upload + vs-parse-sheet)

### Bucket name `sourcing_sheets` (underscore), not VS Pro's `sourcing-sheets` (hyphen)

VS Pro uses `sourcing-sheets`. HQ uses `sourcing_sheets` per the port plan § 2 storage table and the existing initial-schema bucket name. The port adapts (frontend upload target, edge function download source) but the bucket itself is unchanged.

### `type` column renamed to `venue_type` in `vs_candidate_venues`

VS Pro's `venues.type` reads as a Postgres / TS reserved word. Rename landed in the 4.1-port migration; vs-parse-sheet writes the new column name on every INSERT. Frontend ports (Sourcing Report, Shortlist, etc.) read `venue_type` from the row going forward.

### PDF parse stays intentionally naive (lifted verbatim from VS Pro)

VS Pro's `parse-sheet` returns 0 venues for PDF uploads (the `pdfjs` / `unpdf` parse-the-table path is unreliable). Port plan § 6 marks parse-sheet as Lift, so HQ keeps the same behavior: PDF -> empty rows -> frontend routes to `/sourcing/error/empty-sheet`. Real PDF table extraction is a post-cutover enhancement, not a port-sub-phase fix.

### Error route handled by a 4.4-port stub; full ErrorState lands in 4.9-port

VS Pro `ErrorState.tsx` is in scope for Phase 4.9-port per port plan § 9. To avoid a five-sub-phase 404 window for parse-fail / empty-sheet conditions, 4.4-port ships a ~30-line `ErrorStateStub.tsx` that reads `:errorKey` from the URL and renders a key-keyed message + back-to-Sourcing link. Stub gets replaced (in place at the same route) when 4.9-port ports the full version. Stub-vs-full divergence is contained to the message rendering; the route + nav target stays put.

### `vs-parse-sheet` slot replacement in production

Failed-attempt `vs-parse-sheet` function is still in production. The 4.4-port version deploys to the same slot, same name, different shape (`{ scout_id, storage_path }` payload, INSERT into `vs_candidate_venues` not `venues`, `venue_type` not `type`). After cutover, the cleanup task reduces from "delete vs-parse-sheet" to "verify the port version is the current deployment". Parallel to how 4.3-port handled `vs-parse-brief`.

### `sourcing_sheets` storage policy tier mismatch is pre-existing drift; not 4.4-port's job

Storage policy on `sourcing_sheets` bucket is `is_producer_or_admin()` while the `vs_*` table RLS is open-authenticated (4.1-port). A `member` user could create a scout via the open-RLS table path but couldn't upload a sheet (storage denies). `docs/auth-model.md` line 13-15 also says members get no VS access, contradicting the table RLS. Reconciliation belongs in the cutover doc sweep, not a 4.4-port sub-phase fix.

## Phase 4.3-port (Brief)

### Brief is a single-page form; PDF parse is an affordance on that form

VS Pro had no real brief surface (`/projects/:projectId/brief` was a `ComingNext` placeholder). Port plan § 9 explicitly directs HQ-from-scratch design. We shipped `/venue-scout/scouts/:id/brief` as a single-page form modeled after `RoleSettings.tsx` (dirty-state tracking, sticky save bar, beforeunload guard, cancel-leave AlertDialog). PDF upload + parse lives ABOVE the field stack as an affordance: drop a PDF, `vs-parse-brief` extracts structured fields via a forced `submit_brief` tool call, producer reviews in a preview panel, clicks Apply to merge into the form. No multi-step wizard. The failed-attempt 4.3.1 path tried a wizard and the carry-along cost wasn't worth it when there's only one card.

### NewScout post-create navigation flips from `sheet_prompt` route to `/brief`

4.2-port shipped `NewScout` routing to `stepToRoute(id, 'sheet_prompt')`, an intentional 404 window until the sourcing flow lands. 4.3-port supersedes that: post-create lands on `/venue-scout/scouts/:id/brief`, which is the first per-scout page producers should hit. Brief's Continue button still calls `stepToRoute(id, 'sheet_prompt')` after saving, so the 404 window simply moves one step downstream until 4.4-port lands.

### `brief_data` canonical jsonb keys: `expected_guest_count`, `notes`, `uploaded_files`

Port plan § 8.2 puts every brief field on `vs_scouts`: named columns for the structured ones (`client_name`, `event_name`, `live_dates`, `city`, `budget`, `event_overview`) and `brief_data jsonb` for everything else. We locked three canonical keys for 4.3-port:
- `expected_guest_count` (number): consumed by `vs-generate-deck` slide templating.
- `notes` (string): freeform context that downstream prompts (`vs-research-venues`, `vs-compile-summaries`) stringify wholesale.
- `uploaded_files` (string[]): storage paths under the `briefs` bucket. Append-only; future audit / re-parse can re-read source documents.

Additional keys passed through from parse ride along inside `brief_data` without a dedicated form field, and downstream prompts stringify the entire jsonb so anything the producer manages to add gets seen by the AI.

### `vs-parse-brief` (port version) replaces the failed-attempt function in place

Same name, same deployment slot, different signature (`{ scout_id, storage_path }` vs the failed `{ session_id, storage_paths[] }`) and different output shape (matches port-plan `brief_data` keys, not the failed `vs_briefs` columns). After cutover, the failed-attempt cleanup task reduces from "delete vs-parse-brief" to "verify the port version is current" (it will be). Uses Claude's native PDF reading via a `document` content block (no `unpdf` round-trip); modern HQ pattern for any single-PDF parse.

### `vs-parse-brief` is `verify_jwt = true`: explicit entry in config.toml

Default is true, so the entry is technically optional, but every prior `vs-*` / `ts-*` function in `config.toml` flipped it OFF for self-invocation. `vs-parse-brief` is the first VS function that keeps the default, and the explicit entry advertises that as a deliberate choice rather than a missed config row.

## Phase 4.2-port (Scout Index + New Scout entry)

### `current_step` derives the producer-facing phase label; no schema column

VS Pro carried a `projects.phase` text column maintained in lockstep with `current_step`. The port drops the column and derives the label from `current_step` via `currentStepToLabel()` in `src/lib/venue-scout/format.ts`. One source of truth, no drift, cheaper writes downstream. Label table lives in the helper; tweak in one file when copy needs to shift.

### NewScout post-create navigates to the eventual sheet-prompt route

`/venue-scout/scouts/:id/sourcing/sheet-prompt` doesn't exist yet (lands in Phase 4.4-port). Post-create still navigates there because that's the correct eventual UX -- producer fills brief, then immediately walks into the sheet-prompt flow. The 404 window is short (4.3-port and 4.4-port land soon) and the alternative (bouncing back to `/venue-scout` and forcing a row click) reads as a regression once the sheet-prompt page exists.

## Phase 4.1 (Scout Dashboard — first Venue Scout surface)

### Venue Scout RLS: one permissive FOR ALL policy per vs_* table, no creator or role scoping

All five vs_* tables (`vs_scouts`, `vs_briefs`, `vs_sourcing_rounds`, `vs_candidate_venues`, `vs_pitch_decks`) got their original four-per-table producer/admin-gated policies dropped and replaced with a single `FOR ALL TO authenticated USING (true) WITH CHECK (true)` policy each. Any authenticated HQ user can now read, create, edit, or delete any scout regardless of who created it.

Rationale: Venue Scout is a collaborative, agency-wide workflow -- a scout isn't personal data owned by one producer. Every team member being able to jump into any open scout and make edits is the right operating model. Creator scoping was carried over from the initial schema as a default-safe starting point; this migration is the intentional unlock.

### vs_briefs.ideal_features text → text[]

Column was `text` in the initial schema. Changed to `text[]` in the same 4.1.1 migration to match the sibling `neighborhoods` column's type and the spec's tagging behavior (multiple distinct features, not a prose blob). Folded into the RLS migration since we were already touching vs_* tables and production had zero vs_briefs rows.

### vs_sourcing_rounds added to supabase_realtime in 4.1.1, not deferred

The migration-reviewer subagent caught that the Researching page (4.x) will subscribe to `vs_sourcing_rounds` via `postgres_changes`. Added `REPLICA IDENTITY FULL` + `ALTER PUBLICATION supabase_realtime ADD TABLE` to the 4.1.1 migration rather than deferring to the Researching page's phase -- deferring would have required a follow-up migration and a re-deploy window when that phase lands. Precedent: `ts_pull_rounds` and `ts_final_reviews` both went into Realtime in the same migration that established the table.

### Spec/wireframe conflict resolutions for Scout Dashboard UI

The Code session resolved several places where the spec and wireframe diverged. Final decisions, locked before 4.1.2:

| Element | Decision | Source |
|---|---|---|
| Stat tiles | Total Found / Shortlisted / In Deck / Pitched | Spec |
| Hero meta row | Project / event / dates / last sourcing, no icons | Spec |
| Edit-brief link | Coral "Edit Brief →" | Wireframe |
| Settings button | Icon button in CTA cluster below primary action | Spec |
| Shortlist row | 38px image thumbnail included | Wireframe |
| "+ New Round" affordance | Header link only; no dashed "+ Add Round" tile | Wireframe minus the tile |

### "View All N" shortlist link count uses shortlistedCount, not totalVenues

Initial implementation used `totalVenues` for the count in "View All N →". Fixed in 4.1.4 to use `shortlistedCount` -- the link routes to `/shortlist`, which only shows shortlisted venues, so showing the total candidate count was misleading. Small bug, caught by code-reviewer.

### PrimaryScoutCTA "deck exists" branch is evaluated before funnel branches

The 8-state decision tree checks for an existing deck before checking pitched/shortlisted counts. Rationale: once a deck exists, that's the most valuable thing to surface regardless of where the funnel stands. Burying it below the pitched/shortlisted branches would hide the deck if the producer later goes back and adjusts shortlist state.

### PrimaryScoutCTA "failed" branch is narrow by design

The failed branch only fires when the latest round failed AND no shortlisted venues AND no pitched venues exist. If any prior-round work exists, the producer gets the appropriate resume CTA for where they left off rather than a generic "start over." The code-reviewer flagged that a secondary "Retry sourcing" might be useful when work exists from a prior successful round -- deferred to a later phase once the full sourcing flow is in and the UX can be evaluated with real data.

### inDeck stat uses pitched && include_in_deck, not include_in_deck alone

Spec text said `venues.filter(v => v.include_in_deck)` but `include_in_deck` defaults to `true`, so that would show every candidate venue as "in deck" until DeckPrep ships and the user actually filters. Tightened to `pitched && include_in_deck` so the stat is meaningful from day one: it counts venues the producer has explicitly selected AND flagged for the deck. A code comment documents the deviation from spec text. Can be revisited when DeckPrep lands if the semantics need to change.

### RoundTile uses "AI" / "SHEET" hero label, not "Round N"

Sourcing round tiles on the Scout Dashboard show the round type (AI-researched vs. sheet-uploaded) as the dominant label rather than a sequential number. Round number is still visible in the card as secondary metadata. The type label is more useful at a glance -- "Round 2" tells you nothing about what the round was; "SHEET" tells you it was a manual upload.

### Shortlist card hidden entirely when scout has zero rounds

When `rounds.length === 0`, the shortlisted venues card doesn't render at all. The hero CTA already handles that state ("Start Sourcing" or "Upload Brief"), so a visible-but-empty shortlist card would be redundant noise. Once rounds exist but nothing is shortlisted, the card renders with a dashed-border empty state and a "Review Candidate Venues" CTA pointing to `/matrix`.

### Venue photo thumbnails deferred to Phase 4.5

Shortlisted venue rows show a literal `IMG` placeholder box in 4.1.3. Real photo plumbing (`vs_venue_photos` table + storage reads) is deferred to Phase 4.5 (Shortlist + Review Selects phase), which is the first phase where photo management is actually part of the workflow. A TODO comment is in place.

### Field.tsx extracted to src/components/ui/ — canonical design-system form label

Extracted a shared `Field.tsx` rather than letting each area define its own label pattern. Canonical form: 12px Roboto Mono foreground label, coral required asterisk, optional muted hint suffix. Two call sites updated in 4.1.2: `NewRoleDetails.tsx` and `RoleSettings.tsx`.

Side effect: NewRoleDetails labels changed from 13px coral to 12px white. That's the correct design-system form — the old version was non-canonical. Visual change is minor but worth eyeballing in the new-role wizard at 4.1.4 before squash-merge.

Rule: any future form label should use `Field.tsx`, not a local copy.

### venueTypes.ts ported verbatim from VS Pro source; heuristics intentionally unchanged

`CANONICAL_TYPES`, `TYPE_STYLES`, `TYPE_FALLBACK_STYLE`, `canonicalizeType()`, and `parseTypes()` were copied without modification from `mirror-nyc-venue-scout-pro/src/components/sourcing/matrix/primitives.tsx`. The canonicalization heuristics (regex patterns that map raw strings to canonical types) are intentionally preserved byte-for-byte so that AI research output from the existing VS Pro edge functions canonicalizes identically in HQ. Any future change to the heuristics needs to be coordinated across both repos until VS Pro is retired.

### SourcingStatusPill returns null on "complete" — same convention as RoundStatusPill

When a sourcing round's status is `complete`, no pill renders. The assumption is that a complete round's status is conveyed by context (venue counts, CTA state) rather than a redundant "done" badge. `researching` = amber + pulsing dot; `failed` = red static. This matches `RoundStatusPill`'s null-on-complete behavior in Talent Scout.

### RankBadge uses bg-input track, not bg-secondary

The score bar track inside `RankBadge` is `bg-input` (Mirror grey, the correct track surface on dark cards). `bg-secondary` is lighter and visually wrong on `bg-surface-alt` cards. This is the same gotcha that bit us in Talent Scout's score bars and is now codified in `src/components/talent-scout/CLAUDE.md`. Added `showBar={false}` prop for surfaces that only need the numeric digit.

### Optional vs_candidate_venues columns deferred to the consuming phase

Columns `key_features`, `derived_attrs`, `venue_overview`, `size_sq_ft`, `capacity`, `source`, and the `vs_venue_photos` table are not added in Phase 4.1. The Scout Dashboard doesn't render any of them. Adding columns before any code consumes them creates drift between schema and implementation. Each will be migrated in the phase that first reads or writes it.

## Phase 3.11 (Scorecard substance restoration + summary field)

### Restored substantive `full_points_rubric` and added separate `summary` field

The Phase 3.7 squash-merge (`2ab37c3`) added a "≤ 12 words, one sentence" cap to `full_points_rubric` in `scorecardGenerationPrompt`. The intent was good — block tiered point breakdowns inline like "10 pts: 5+ yrs · 5 pts: 2-4 yrs" — but the cap was over-aggressive and stripped concrete-signal evidence the per-candidate evaluator actually relies on. Recently-generated scorecards came back thin and abstract ("Strong portfolio") instead of rich and actionable ("5+ years of professional experience in graphic design with meaningful exposure to environmental, experiential, or spatial design contexts. Portfolio includes spatial graphics, signage systems, or large-scale environmental work.").

Phase 3.11 fixes this additively, the way it should have been done in 3.7:

1. **`full_points_rubric` restored to the substantive form** — 1-3 sentences (typically 25-60 words) of concrete signals: years expected, named tools, types of work / clients, where the signal lives in the candidate's materials. The per-candidate evaluator reads this field. Bad-example block keeps the "no tiered point breakdowns" prohibition since that was a real design constraint.
2. **New `summary` field** — short (≤ 14 words) condensed recap used in compact UI surfaces (candidate detail score breakdown, packet matrix headers, recap views). Generated alongside `full_points_rubric` in the same Claude pass, never replaces it. The evaluator never reads `summary`.

Both fields are stored on the criterion (jsonb scorecard, no migration needed). Existing roles have only `full_points_rubric` populated (the post-3.7 short version); UI surfaces that want compact display fall back to truncating it when `summary` is empty. Re-running scorecard generation OR clicking "Process scorecard" on the wizard / Edit Role page (Phase 3.10) re-populates both fields with the new substantive shape.

The defense-in-depth merge in `ts-refine-scorecard` was extended: model is trusted for `name` / `full_points_rubric` / `summary`; everything else (tier, weight, is_disqualifier, is_manual) is restored from user input regardless of model output.

## Phase 3.10 (Scorecard refinement step)

### Refinement is a separate manual step, not auto-triggered on edit

When the user edits or adds criteria on the wizard step-3 page, the refine pass doesn't fire automatically. The bottom-bar button morphs from **Approve & lock** to **Process scorecard**, and the user has to actively click it. Two reasons:

1. The user is often making one edit in a stream of edits (typing a describer, then adjusting a weight, then adding another criterion). Auto-firing refine on every change would burn Anthropic spend and force a UI redraw mid-edit. A manual step lets them queue up everything they want to revise, then commit to a single Claude pass.
2. The refinement is a non-trivial AI call (a few seconds, a few cents). Making it explicit means the cost is tied to a clear intent ("I'm done editing for now"), not to keystrokes.

### Refinement preserves user scoring decisions via post-Claude merge, not prompt discipline alone

The prompt asks Claude to leave `tier`, `weight`, `is_disqualifier`, and `is_manual` untouched, but the edge function's `mergeRefinedIntoOriginal` re-applies the user's input values for all four fields regardless of what the model returned. Belt + suspenders. The model is only trusted for `name` and `full_points_rubric`. A model that ignores the prompt and tries to "improve" weights (or add/remove criteria) can't break the user's intent — the merge silently restores the user values. Output count is also enforced at the same length as input.

This pattern is worth lifting if we ever build other "refine user input via Claude" features: trust the model for the field you're asking it to refine, mechanically restore the rest from input.

### Dead-criterion drop is server-side, before the prompt

Criteria with `weight=0` OR with both `name` and `full_points_rubric` empty/whitespace get dropped before `scorecardRefinementPrompt` ever sees them. Two reasons:

1. The prompt is told to preserve every entry. Asking it to also "drop dead ones" is conflicting guidance — the model would either silently leave them in or aggressively remove things the user wanted to keep. Better to handle removal mechanically before the model is even asked.
2. Burning tokens to refine an empty entry is waste.

The response includes `removed_count` so the wizard / RoleSettings toast can surface it. If a user has every criterion zeroed or empty, the function returns 400 ("nothing to refine") rather than crashing — the user fixes the input and re-tries.

### Same edge function powers both scorecard surfaces

`ts-refine-scorecard` is called by the wizard step-3 page (`NewRoleScorecard.tsx`) AND the Edit Role page (`RoleSettings.tsx`). Both surfaces share the wizard's "scorecard edited since last refine → Process button" pattern; on the Edit Role page, post-refine the button flips back to the existing **Save changes** flow that fires `ts-bulk-reevaluate`. One function, two call sites — no duplicated prompt or merge logic.

### Tier re-sort happens client-side, not in the prompt

After every refine, the frontend re-sorts each tier highest-weight first. The prompt is told to preserve order, but the visual reorganization is the client's job. Reasoning: the model's order discipline is unreliable and we want a predictable display contract regardless of what came back. Client-side sort is cheap and idempotent (no-op if weights didn't change).

## Phase 3.8 + 3.9 (Cron, watchdogs, pull notification)

### Watchdog stall thresholds

Pull = 5 min (Phase 3.11.1, was 60). Re-eval = 30 min. Final review = 20 min.

The pull pipeline updates `ts_pull_rounds.updated_at` at every per-candidate completion (the `updated_at_auto` trigger fires on each row update). So `updated_at` = "last candidate completed at" — heartbeats fire per candidate, not per pool. A single candidate hanging >5 min is always a stall, regardless of total pool size. The earlier 60-min threshold was set under the misconception that large pools legitimately sit between heartbeats; they don't.

Bulk re-eval and final review keep the looser thresholds. Bulk re-eval writes `ts_roles.reeval_last_progress_at` per chunk completion (a slower cadence than per-candidate), so 30 min is right. Final review is one Anthropic call wrapped in `EdgeRuntime.waitUntil` — at HARD_CAP=50 it lands in 5-10 min, so 20 catches dead workers without false-positives.

Pull-watchdog cadence also bumped from every 5 min to every 2 min so detection lands within 5-7 min of stall onset (vs 5-10 min before). False-positive cost is low because the threshold is the actual signal of trouble — a candidate stuck >5 min won't recover on its own.

Status name aligned with the other two watchdogs: pull-watchdog now flips to `failed` (was `stalled`). The user-facing surface treats both identically (manual retry decision) so the distinction wasn't earning its keep.

### Cron cadences

Watchdogs every 5 minutes. Scheduled pulls daily at 12:00 UTC (8am ET). Storage cleanup daily 03:00 UTC. Spend reset 1st of month 00:01 UTC.

5-minute watchdog cadence is fine — they're cheap (one indexed query each). Faster cadence would catch stalls a few minutes earlier but pg_net call volume scales with cron firings, and the SLA on stalled-pull recovery is "before the user notices and asks", not seconds. The 12:00-UTC schedule for `ts-cron-scheduled-pulls` is intentionally early-morning ET and accepts the EDT/EST-drift hour: this is internal hiring tooling, not customer-facing, so a 1-hour shift twice a year doesn't matter.

### Cap-alert recipient lookup

`getAdminEmail(sb)` returns the oldest active admin in `public.users` (ORDER BY `created_at` ASC LIMIT 1). Falls back to `jobs@mirrornyc.com` if no admin row exists.

Picked oldest-admin over a hardcoded address so the alert routes correctly if Jimmie ever transfers admin ownership without anyone updating env vars. The fallback to `jobs@` means a misconfigured database (no admin user) still notifies *someone* who can act. This is one piece of plumbing that should be self-healing — the cap alert is what tells you something else is wrong.

### Pull-completion notification path: standalone in 3.9, fold into `notifications-dispatch` later

`ts-send-pull-notification` ships as a standalone edge function in 3.9 to unblock Talent Scout's "happy path" (manager forwards a candidate to jobs@ and gets an email back when the round completes). The unified `notifications-dispatch` (in-app bell + email + per-user prefs) is Phase 5 work that depends on the HQ Notifications system landing. Building 3.9 against the future API would gate Talent Scout shipping on Phase 5; building it standalone lets Phase 5 swap the call site later (one-line replacement in `ts-pull-candidates`'s `dispatchPullCompleteNotification`).

The notification is fired fire-and-forget via `EdgeRuntime.waitUntil` so a Gmail outage never fails the upstream pull. The `ts_pull_rounds` row is already at `status='complete'` before the notification dispatch starts.

### Storage cleanup is cron-only, no UI trigger

`ts-cron-storage-cleanup` runs daily at 03:00 UTC with conservative retention windows (rejected attachments >30d, closed-role attachments >90d, hard-delete closed roles >60d). No Settings-page manual trigger — the daily cadence catches garbage well before it becomes a problem, and exposing a button to admins to run an aggressive out-of-cycle purge invites mistakes. If the admin ever needs to force-clean (post-recruiting-cycle Storage cleanup, etc.), the function can be invoked manually from the Supabase Functions dashboard with the cron defaults; no special API surface needed.

### `pg_cron` invocation through a SECURITY DEFINER helper, not inline `net.http_post`

`public.invoke_edge_function(fn_name, body)` reads two GUCs (`app.supabase_url`, `app.internal_api_secret`) at call time and POSTs to `${base_url}/functions/v1/${fn_name}` with the internal-secret header. Cron schedules call this single helper.

Rationale: keeps secrets out of `cron.job` rows (which are queryable by anyone with `pg_cron` permissions). GUC values stick around in the database config but require a separate `ALTER DATABASE` to inspect. Also makes the schedule SQL readable — `SELECT public.invoke_edge_function('ts-cron-pull-watchdog')` reads as "fire pull watchdog", not as a 6-line `net.http_post(url := ..., headers := ..., body := ...)`. Adding a new cron job is one line.

The GUCs are set out-of-band (Supabase SQL editor) before the migration applies in production. Without them, the helper warns and no-ops — the schedule rows still exist; they just don't actually call anything. This means the migration is safe to apply before the GUCs are populated.

## Phase 3.7 (Candidates UX + referral ingestion)

### `manually_reviewed` boolean as one-way flip; `auto_rejected` enum value deprecated

Hiring managers needed a way to lock candidate decisions against future re-evals. Adding a per-candidate `manually_reviewed` (default false) on `ts_candidates` is the cleanest split: AI eval / re-eval leaves it false; user actions (status-dropdown change, re-select-same, AUTO-pill click, bulk action) flip it to true. Re-eval respects the flag — when true, score / strengths / gaps / overview update but status doesn't. Bulk re-eval defaults to `not_manually_rejected` (`status.neq.reject,manually_reviewed.eq.false`) so manually-rejected candidates aren't reconsidered.

The `auto_rejected` enum value (originally distinguishing AI-confirmed rejections from human ones) became redundant once `manually_reviewed=false + status=reject` carries the same semantics. Backfilled all existing `auto_rejected` rows in migration `20260507092912`. Enum value kept in place — dropping it requires a full enum rebuild, not worth it. New writes never use it.

### Referral identity = original applicant; `referrer_email` captures the manager

When a Mirror manager forwards a candidate to jobs@, the candidate row's identity is the **original applicant's** name + email — not the manager's. The manager's email goes on a separate `referrer_email` column, paired with `is_referral=true`. Eval is **blind** to referral status (same prompt). Referrals get a UI affordance (electric-blue ReferralPill) but no scoring lift. This keeps the dashboard's master-pool ordering meaningful regardless of source path.

Tried `referral` as a status enum value first; rejected because referral isn't an outcome state, it's a source flag. A referred candidate can still be in any status.

### Forward parser walks every chain segment, picks deepest non-Mirror

A single regex looking for the FIRST `From:` header would lock onto the manager (who's `@mirrornyc.com`) instead of the original applicant. So the parser collects every `From:` header AND every `On <date> <Name> <<email>> wrote:` reply-quote attribution into a positions-sorted hits list, then walks in reverse to pick the deepest sender whose email isn't `@mirrornyc.com`. When every hit is `@mirrornyc.com`, returns null and the message is skipped (better to skip than misattribute). Apple Mail iPhone forwards (which represent the original applicant as a quoted reply rather than a re-headered forward) covered by the wrote-attribution branch.

### Capture every `@mirrornyc.com` manager's commentary into `internal_notes`

Phase 3.7.8.16: managers often forward with their own context ("strong fit, schedule a call" / "borderline, lmk what you think"). When that commentary lands in jobs@'s body, it's the most reliable signal we have about the candidate. `extractManagerNote` walks every explicit-forward segment in the chain (Gmail's `---------- Forwarded message ---------` and Apple Mail's `Begin forwarded message:`), parses each segment's `From:` header, and for any `@mirrornyc.com` sender captures the body with Mirror signatures stripped (bolded-name + brand-marker heuristic) and "from-mobile" Apple Mail tags filtered. Multi-manager chains attribute each note with `Note from <email>:`. Folded into the FIRST eval via the `HIRING MANAGER NOTES:` block in the candidate bundle (the eval prompt already treats that block as verified context that supersedes resume / cover-letter inferences).

### `mirrornyc.com` blocked from portfolio URL extraction

Manager email signatures embed `http://www.mirrornyc.com/` and `@mirror_nyc`. The portfolio scorer was promoting those as the candidate's portfolio. `mirrornyc.com` added to `BLOCKED_PORTFOLIO_DOMAINS` in `_shared/unwrapUrl.ts` so it's filtered at extraction time — never enters `detected_links`, never becomes `portfolio_path_or_url`.

### Global competitor list as `text[]` on `global_settings`; per-role override on `ts_roles.competitor_bonus`

Mirror has a canonical 19-entry list of competitor agencies that should bonus-credit candidate experience across every role. Stored as Postgres `text[]` on `global_settings` (flat array, simple membership check). Per-role override stays on `ts_roles.competitor_bonus` (jsonb, carries a `bonus_points` scalar alongside the array). Seeded via two migrations (conditional UPDATE + idempotent DO block) so the canonical list is enforceable on existing rows AND new installs.

### Stepped pull-running checklist driven by existing signals, not new step_progress writes

Source repo writes per-step state to a `step_progress` jsonb column on `pull_rounds`. HQ's port intentionally dropped that ornamentation in Phase 3.4 to keep `ts-pull-candidates` simple. For the stepped UI in 3.7.8.6, kept the simpler approach — derived a 4-step checklist (search / dedupe / process / save) from the existing `candidates_found` + `processed_count` + `status` columns. Less granular than the source's 6-step view but covers the practical UX (most of the running window is "processing X of N"), and avoided re-adding per-substep writes across the entire pull pipeline.

### Toasts default to Mirror coral; ReferralPill stays electric blue

Toasts site-wide flipped from black/red destructive variant to solid Mirror coral with white bold text — coral is the brand attention color. ReferralPill briefly tried coral too (3.7.8.8), reverted in 3.7.8.13 because too many other coral surfaces (Master Pool header, primary buttons, toasts) made the referral signal disappear. Back to the original electric blue, which stands cleanly apart from the muted-grey AUTO/MANUAL pill it sits beside.

### Slider track + score bar track use `bg-input` on Mirror-grey card surfaces

Phase 3.7.6 moved many cards to `bg-surface-alt` (#141414, Mirror grey). The shadcn slider track and `ScoreInline` bar track used `bg-secondary` (#141414) — same color, invisible against the new card surfaces. Made the empty portion of every slider and the unfilled portion of every score bar disappear. Flipped both to `bg-input` (#292929) so the track always reads against any card surface.

### Top nav reduced to Dashboard + Talent Scout

Projects / Venues / Clients / Tasks reachable by drilling in from the Dashboard tile grid. Top nav's job is high-level orientation, not "every route in HQ". Routes still work; they just don't have nav slots.

## Phase 3.6 (Final review + packet)

### Q5: split into two edge functions, share via `_shared/packetRender.ts`

Source ships two ~800-line packet generators (`generate-packet` round-scoped, `generate-final-review-packet` review-scoped) that share ~50% of their code (CloudConvert helper, Gmail/Storage attachment fetch, candidate title/email pages, packet divider, BASE_CSS, htmlDoc wrapper, helpers). Consolidating into one function would mean a 200-line if/else inside the renderer because the cover, body table (matrix vs rankings), writeup categories, and classification semantics are all different and pull from different DB tables (`ts_pull_rounds` vs `ts_final_reviews`).

Split into `ts-packet-generate` + `ts-final-review-packet`, lift the shared infrastructure into `supabase/functions/_shared/packetRender.ts`. Net: each domain function ~250 lines, shared module ~400 lines, ~44% smaller than source's 1,599 lines combined.

### `final_overview` field on each `ts_final_reviews.final_rankings` entry

Source had no equivalent. Hiring managers reviewing the final pool need a comparative angle that the per-candidate `quick_overview` (generated during pull-time) doesn't provide — quick_overview is "what's in this candidate's materials"; final_overview is "what unique strengths or angles this candidate brings to Mirror NYC that distinguish them within this final pool."

The AI generates 4-6 short headlines per candidate, framed as positives about the candidate (never by direct comparison to others — the comparative reading is what the hiring manager does, not the AI). Stored on the `final_rankings` jsonb entry. Surfaced in `FinalReviewDetail`'s candidate table where the dashboard CandidateTable would otherwise show Quick Overview.

Final entry shape: `{candidate_id, final_rank, final_tier, rationale, recruiter_note, final_overview}`. `final_rank` kept (despite not being in Jimmie's literal spec) because deriving rank from tier + secondary sort is brittle; source's reasoning still applies.

### Field renames vs source: `final_tier` (was `recommendation_tier`), `rationale` (was `narrative`)

HQ's naming is more direct. Source's field names came from an earlier iteration; this rename happens as part of the port and won't ripple back.

### `unwrapSecurityWrapper` ported and applied broadly

Email-security services (Outlook safelinks, Mimecast, Proofpoint URLDefense, Cuda LinkProtect, EdgePilot) wrap outgoing links so clicks route through their redirect first. When candidates send portfolio links from a corporate email account, those wrappers leak into HQ via Gmail ingestion. Source had `lib/unwrapUrl.ts` to strip the wrapper before opening the actual URL.

Phase 3.6 ports the helper to `src/lib/unwrapUrl.ts` and applies it everywhere a portfolio URL is rendered:
- `CandidateTable` (portfolio cell button on the dashboard table)
- `CandidateDetail` (portfolio web link + every detected_links row)
- `FinalReviewDetail` (rankings table portfolio cell)

Cheap insurance; prevents click-through routing through Google/Outlook/Mimecast redirects when the user wants the actual portfolio site.

### `include_fast_track` toggle on FinalReviewDetail

Source had a checkbox; HQ surfaces the same toggle. Default `true` (full coverage — packet includes every fast-tracked candidate's pages even if they're outside the top-N tier). Hiring managers occasionally want a tighter top-tier-only packet; the toggle gives them that escape. Seeded from the review row's `packet_include_fast_track` if a packet has been generated before, so re-generation defaults to the previous preference.

### Tier subtotals in the packet matrix render `—` instead of `0` when score_breakdown is empty

When a candidate's `score_breakdown` jsonb is empty (legacy candidate, or a candidate where the AI returned no per-criterion breakdown), the matrix used to show T1=0 / T2=0 / T3=0 / Bonus=total. That reads as "candidate scored zero on Tier 1" rather than "we don't have the breakdown." Misleading zeros are worse than honest missing data. Now renders `—` per missing tier; total still renders correctly (it lives on `ts_candidates.score`).

Applies to the round packet's Top Candidate Comparison Matrix. Per-criterion display in CandidateDetail's score breakdown panel keeps existing "0 / X" behavior since each criterion has its own line item — viewer can tell at a glance whether the breakdown was populated.

### Cron watchdog for stalled `ts_final_reviews` deferred to Phase 3.7

Phase 3.7 is the dedicated cron + watchdog phase (`ts-cron-scheduled-pulls`, `ts-cron-pull-watchdog`, `ts-cron-reeval-watchdog`, `ts-cron-storage-cleanup`). `ts-cron-final-review-watchdog` joins that batch — same pattern as the others (heartbeat detection, status flip to `failed` on stall, no auto-restart). Not bolted onto 3.6.

### HQ-specific: skip Gmail re-fetch at packet time, read attachments from Storage

Source's packet generators re-fetch attachments from Gmail using OAuth refresh tokens. Phase 3.4 already persists every attachment to the `candidate_attachments` Storage bucket on initial pull, so HQ doesn't need that round-trip. `_shared/packetRender.ts` reads bytes from Storage instead. Cleaner code path, no Gmail dependency at packet time, faster (no token mint).

### HQ-specific: email packet to hiring manager via Gmail service account

Source's packet generators return a download URL only — the user manually shares the PDF afterward. HQ adds an email step: after upload, the function sends the packet PDF to the role's hiring manager from `jobs@mirrornyc.com` via the service account's `gmail.send` scope (added to `_shared/gmailServiceAccount.ts` SCOPES list in this phase). Best-effort: failures don't fail the overall request — the user still gets the download URL. Hiring manager email is read from `users` joined on `ts_roles.hiring_manager_id`.

### HQ-specific: PDF coral stays at source's `#ef5b5b`, not deck-canonical `#BE4E44`

The Phase 3.5b brand pass moved HQ's UI coral to `#BE4E44` (deck-canonical). Inside packet PDFs, BASE_CSS keeps `#ef5b5b` because the dustier coral reads dim on paper print and on screen-share PDF previews. Same brand identity, different surface (screen UI vs paper artifact).

### `ts_candidates.email_body_text` column added; packet email page skipped when null

Source's packet shows the candidate's original application email as a white "doc-slot" page inside their per-candidate section. HQ didn't persist email body text in Phase 3.4. This phase adds `email_body_text text` (nullable) and updates `ts-pull-candidates` to populate it (trimmed at 30k chars). The packet renders the email page only when the column is non-null — pre-3.6 candidates won't have it, but their title page + attachments still render correctly.

## Talent Scout port (Phase 3) — locked Q1–Q6

Resolutions to the six open questions in `docs/talent-scout-port-plan.md` § 8.

### Q1: re-eval history → keep history

`ts_evaluations` is a separate history table. Every single re-eval (CandidateDetail's button, row-level Re-evaluate selected bulk action) INSERTs a new row, preserving prior scores for audit. The latest row's fields are mirrored onto `ts_candidates` for fast list queries.

**Bulk re-evaluate** (role-scoped or round-scoped "Re-Evaluate Pool") is the one exception: it implies the prompt or scorecard changed, so prior evals are no longer meaningful. The `overwrite_history: true` flag on `ts-evaluate-candidate` deletes prior `ts_evaluations` rows for the candidate before inserting.

**Why both modes**: a single re-eval is usually the user fixing one candidate's classification or pulling new info — history matters. A bulk re-eval is the user changing the scoring rules — old scores aren't comparable, keeping them around just clutters the audit trail.

### Q2: pending-candidate parking spot → jsonb on the round

`ts_pull_rounds.pending_candidates` (jsonb, default `[]`) holds Gmail message IDs the chunked pipeline batches in groups of 8 across self-invocations. Matches the source pipeline's existing shape; no separate table.

### Q3: hiring manager identity → block on first sign-in

`ts_roles.hiring_manager_id` FKs to `users`. New-role wizard looks up by email at submit. If no `users` row exists yet, role creation is blocked: "Hiring manager must sign in to HQ at least once first." No auto-creating users from email strings.

### Q4: notification consolidation → standalone first, fold later

Phase 3.8 ships `ts-send-pull-notification` standalone so Talent Scout doesn't block on Phase 5 work. Phase 5 folds it into `notifications-dispatch`.

### Q5: two packet generators → read both, then consolidate

Before writing `ts-packet-generate` in Phase 3.6, do a 30-min read of source's `generate-packet` (832 lines) vs `generate-final-review-packet` (767 lines) to confirm whether they're two distinct flows (candidate-pool packet vs final-review packet) or one is dead code. Consolidate based on that read.

### Q6: anthropic-spend-tracker shape → explicit `callClaude(app, ...)` wrapper

Single helper in `supabase/functions/_shared/anthropic.ts`. Selects key from `ANTHROPIC_API_KEY_TS` / `_VS` / `_HQ` based on the `app` argument. After each successful call, computes cost from the response usage block (incl. prompt-cache discounts) and increments `global_settings.anthropic_spend_current_month_usd`. Emails the admin once per cap crossing, gated by `cap_alert_sent_this_month`. **Does NOT refuse calls when over cap** — graceful degradation, not a hard failure.

## Phase 3.4 (pull pipeline)

### Edge Function self-invocation auth

The Supabase gateway on this project rejects the service-role bearer token at its `verify_jwt` layer (likely a new-format-key vs legacy-JWT mismatch). Solved with per-function `verify_jwt = false` in `supabase/config.toml` + an `INTERNAL_API_SECRET` shared secret + auth enforcement in `_shared/internalAuth.ts` (three accept-paths: internal-secret header, service-role bearer match, valid user JWT). See `docs/auth-model.md` for the full pattern.

Any future self-invoking function uses the same pattern; non-self-invoking functions stay on default `verify_jwt = true`.

### Realtime publication

`supabase_realtime` publication on this project starts empty. `ts_pull_rounds` was added to it via migration with `REPLICA IDENTITY FULL` so PullDetail's `postgres_changes` UPDATE subscription receives the full new row. Any future table the UI subscribes to needs the same.

### All attachments to Storage (drift from source)

Source repo kept small attachments in Gmail and let the dashboard fetch them on demand via a `gmail-attachment` Edge Function. HQ persists every attachment to the `candidate_attachments` bucket regardless of size. Slightly more Storage cost; much simpler download path (`supabase.storage.createSignedUrl`); no separate Edge Function for candidate-detail attachment viewing.

### `ts_pull_rounds` operational columns

`candidates_found`, `processed_count`, `attempt`, `round_number` added so progress and round labels work without joining `ts_candidates` per render. Source's `step_progress` jsonb / `current_step` / `error_log` were dropped — simpler `processed_count / candidates_found` is enough; richer progress UI can be added back later if needed.

## Phase 3.5 (candidate detail + re-eval)

### Re-eval history retention with one bulk-overwrite escape hatch

See Q1 above. Implementation note: the candidate-detail UI shows only the latest fields (mirrored onto `ts_candidates`); history accumulates server-side without a UI surface yet. Future "score history" timeline page can read from `ts_evaluations` when it's needed.

### `promote` → `interview` enum rename

Original schema used `promote` as the "advance" status. Renamed to `interview` in Phase 3.5 — concrete next-stage action that maps to actual hiring workflow language. `ts_candidate_status` is now `(consider, interview, reject, fast_track, auto_rejected)`. Migration verified zero rows used `promote` before renaming.

### Status priority is the primary sort everywhere

`CandidateTable` sorts by status bucket first (Interview → Fast-Track → Consider in active tier; Rejected → Auto-Rejected in collapsible rejected tier), then by user-selectable column. Buckets never interleave regardless of column or direction. The active/rejected divider is collapsible inline, not a separate table.

### Bulk re-eval split: role-scoped uses `ts-bulk-reevaluate`, round-scoped fans out

`ts-bulk-reevaluate` (chunked self-invoke, `verify_jwt = false`) operates on the role's master pool with optional `status_filter`. PullDetail's "Re-Evaluate Pool" is round-scoped and skips the dedicated function — instead, it fans out parallel `ts-evaluate-candidate` calls (concurrency=6) with `overwrite_history: true` from the browser. Floating bottom-right widget shows progress; cancellable mid-run.

### Round-scoped state on `ts_pull_rounds`, role-scoped state on `ts_roles`

Source repo put bulk-reeval state on `pull_rounds`. HQ moved to role-scoped: `reeval_status` / `reeval_total` / `reeval_processed` / `reeval_failed` / `reeval_started_at` / `reeval_completed_at` / `reeval_last_progress_at` columns live on `ts_roles`. The legacy `ts_pull_rounds.reeval_last_progress_at` from Phase 3.2 is dead (drop in a future cleanup migration).

### Status dropdown writes are awaited before parent refetch

`StatusDropdown.onValueChange` awaits the DB UPDATE before calling its `onChange` callback (which triggers parent reload). Calling `onChange` first races the write and leaves the displayed value one click behind. **Future inline-mutation components in HQ follow the same order.**

## Phase 2 (schema + auth)

### `handle_new_user` Postgres trigger replaces `auth-on-signup` Edge Function

Original spec called for an `auth-on-signup` Edge Function. Implemented as a Postgres trigger on `auth.users` instead, running with service-role privileges. Simpler, atomic with the auth.users insert, no cold-start latency. The Edge Function name is reserved in case we need extra signup-time work later (e.g. provisioning Drive folders); for now it doesn't exist.

### Project security defaults: Auto-expose OFF, Auto-RLS ON

Every new table requires explicit `GRANT` to `authenticated` and `service_role`. Forces every new table to be reviewed for which roles can hit the Data API at all, separate from RLS row-level policy. See `docs/conventions.md`.

## Open

Decisions still up in the air; revisit when the relevant phase starts.

- **Project status enum trim.** Current 14 values may consolidate. Defer until Phase 5 polish.
- **`venue_types` lookup values.** Jimmie provides before Venue Scout build (Phase 4).
- **Talent Scout data extraction (Phase 6.2).** Plan: re-create active roles via Gmail re-pull, preserve closed roles as packet PDF archives. If Phase 6 inventory turns up data that doesn't fit, revisit then.
