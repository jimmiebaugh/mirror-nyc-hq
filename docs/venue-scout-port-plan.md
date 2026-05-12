# Venue Scout port plan

**Status:** Locked 2026-05-11. Ready for Code to commit as the first entry on `vs-port-fresh` (off `dd38577`). All six open questions answered; § 8 carries the locked decisions.
**Source repo:** `/Users/jimmie/Code/mirror-nyc-venue-scout-pro`.
**Target:** `/venue-scout` route tree inside Mirror NYC HQ, ported 1:1 from VS Pro with HQ design-system styling applied from the start (same approach Phase 3 took for Talent Scout).

This doc drives Phase 4 sub-phase sequencing on `vs-port-fresh`. The failed Phase 4 attempt on `main` (4.1 through 4.6) is archived; nothing in this plan references its surfaces or schema. Where the failed attempt produced reusable infrastructure (canonical UI primitives, `_shared/googleServiceAccount.ts`, `_shared/anthropic.ts` tools extension), § 10 lists what to cherry-pick lazily as each sub-phase needs it.

---

## 1. What VS Pro is

VS Pro is a single-page React app for sourcing venues for one event at a time. The workflow is linear: dashboard → brief upload OR skip → AI research OR sheet upload → candidate matrix → shortlist → final review → compile summaries → deck prep → Google Slides deck generated. Every page is a route under `/projects/:projectId/...`, and `projects.current_step` is the single source of truth for "where in the flow is this project."

**Tech stack diff vs HQ:**

| | VS Pro | Mirror NYC HQ |
|---|---|---|
| React | 18.3.1 | 18.3.1 (match) |
| Vite | 5.4.19 | match |
| Router | React Router 6.30 | match |
| Tailwind | 3.4.17 | match |
| shadcn/ui | yes | yes (don't port; HQ has its own copies) |
| TanStack Query | 5.83 | match |
| DnD | @dnd-kit | not yet in HQ; add when porting Phase 4.6-port |
| Supabase | yes | yes (different project ref) |
| Auth | **none (link-shared, anon RLS)** | Google OAuth, `@mirrornyc.com` hd, three permission tiers |

The auth model is the biggest semantic difference. VS Pro is a link-shared internal tool with `FOR ALL` permissive RLS and no user identity. HQ has Google OAuth, a three-tier permission model (member / producer / admin), and `auth.uid()` everywhere. The port wraps every VS surface in `<ProtectedRoute>` (matching the existing Phase 4 main-branch posture) and writes `created_by` / `last_touched_at` on every relevant row.

**The workflow as 12 routes** (VS Pro source path → HQ port path):

| VS Pro route | HQ port route |
|---|---|
| `/` | `/venue-scout` |
| `/projects/new` | `/venue-scout/scouts/new` |
| `/projects/:projectId/brief` | `/venue-scout/scouts/:id/brief` |
| `/projects/:projectId/sourcing/sheet-prompt` | `/venue-scout/scouts/:id/sourcing/sheet-prompt` |
| `/projects/:projectId/sourcing/sheet-upload` | `/venue-scout/scouts/:id/sourcing/sheet-upload` |
| `/projects/:projectId/sourcing/researching` | `/venue-scout/scouts/:id/sourcing/researching` |
| `/projects/:projectId/sourcing/report` | `/venue-scout/scouts/:id/sourcing/report` |
| `/projects/:projectId/sourcing/shortlist` | `/venue-scout/scouts/:id/sourcing/shortlist` |
| `/projects/:projectId/sourcing/review` | `/venue-scout/scouts/:id/sourcing/review` |
| `/projects/:projectId/sourcing/compiling` | `/venue-scout/scouts/:id/sourcing/compiling` |
| `/projects/:projectId/deck/prep` | `/venue-scout/scouts/:id/deck/prep` |
| `/projects/:projectId/deck/generating` | `/venue-scout/scouts/:id/deck/generating` |
| `/projects/:projectId/sourcing/error/:errorKey` | `/venue-scout/scouts/:id/sourcing/error/:errorKey` |

Same flow, same step names, scoped under `/venue-scout/scouts/:id` for consistency with HQ's existing route conventions and for namespacing against future HQ surfaces.

---

## 2. Schema diff

VS Pro has four tables; the port maps each to an HQ `vs_*` table. **The existing `vs_*` tables created by the failed Phase 4 attempt are not load-bearing** (no production data; RLS open; nothing queries them after revert). Port migrations include `DROP TABLE IF EXISTS` at the top so the new shape lands cleanly.

### Table mapping

| VS Pro (source) | HQ (`vs_*`) | Action | Notes |
|---|---|---|---|
| `projects` | `vs_scouts` | **Adapt.** Rename. Add `created_by uuid FK users`, `updated_by uuid FK users`. Optional `project_id uuid FK projects` for linking to HQ project records (nullable; supports standalone scouts). | Carries `current_step` as the workflow state machine; keep it. |
| `venues` | `vs_candidate_venues` | **Adapt.** Rename (HQ already has a `venues` table for the master venue list; `vs_candidate_venues` is the round-scoped sourcing pool). FK `scout_id → vs_scouts.id`. | Drop the `sourcing_round_id` concept the failed attempt introduced; VS Pro has one flow per scout. See § 8.1. |
| `venue_notes` | `vs_candidate_venues.notes` | **Inline.** Don't port the separate table; collapse onto a `text` column. | Matches HQ convention (notes are 1:1 with the parent row everywhere else in HQ). |
| `venue_photos` | `vs_venue_photos` | **Lift.** Same shape: `venue_id FK`, `slot 1-4`, `storage_path`. `ON DELETE CASCADE` on the FK so cleanup is automatic. | The Phase 4.5 main-branch version had cascade; carry that decision forward. |

### Field rename map

```
# projects → vs_scouts
projects.id                       → vs_scouts.id
projects.client_name              → vs_scouts.client_name
projects.event_name               → vs_scouts.event_name
projects.live_dates               → vs_scouts.live_dates
projects.city                     → vs_scouts.city
projects.budget                   → vs_scouts.budget
projects.brief_data               → vs_scouts.brief_data        (jsonb, keep flexible)
projects.event_overview           → vs_scouts.event_overview
projects.status                   → vs_scouts.status
projects.phase                    → vs_scouts.phase
projects.archived                 → vs_scouts.archived_at       (timestamptz; null = active. HQ convention from projects table.)
projects.derived_columns          → vs_scouts.derived_columns
projects.sheet_storage_path       → vs_scouts.sheet_storage_path
projects.generated_decks          → vs_scouts.generated_decks   (jsonb array; keeps VS Pro's deck-history shape)
projects.current_step             → vs_scouts.current_step
projects.deck_order               → vs_scouts.deck_order
projects.created_at / updated_at  → same

# venues → vs_candidate_venues
venues.id                         → vs_candidate_venues.id
venues.project_id                 → vs_candidate_venues.scout_id      (rename + FK retarget)
venues.name                       → same
venues.neighborhood               → same
venues.address                    → same
venues.type                       → vs_candidate_venues.venue_type    (rename; "type" reads as system word)
venues.key_features               → same
venues.website_url                → same
venues.size_sq_ft                 → same
venues.capacity                   → same
venues.derived_attrs              → same
venues.recommendations            → same  (text[])
venues.considerations             → same  (text[])
venues.ranking_score              → vs_candidate_venues.rank          (rename to "rank" for parity with HQ Talent Scout score naming)
venues.source                     → same  ('sheet' | 'research' | 'manual')
venues.shortlisted                → same
venues.pitched                    → same
venues.venue_overview             → same
venues.include_in_deck            → same

# venue_notes → vs_candidate_venues.notes (inline)
venue_notes.content               → vs_candidate_venues.notes  (text)

# venue_photos → vs_venue_photos
venue_photos.venue_id             → vs_venue_photos.candidate_venue_id   (rename to match parent table name)
venue_photos.slot                 → same  (1-4, CHECK constraint)
venue_photos.storage_path         → same
```

### Schema additions HQ needs

These are HQ-specific operational concerns that VS Pro didn't have because it had no auth. Add in Phase 4.1-port (schema augmentation):

- `vs_scouts.created_by uuid FK users`: who created the scout. Required (every scout has a creator in HQ).
- `vs_scouts.updated_by uuid FK users`: last writer. Optional; nullable.
- `vs_scouts.last_touched_at timestamptz`: tracks meaningful user activity (sourcing kick-off, brief save, deck generated), not bookkeeping `updated_at`. Used for Scout Index sort. Same precedent as the failed Phase 4.2.
- `vs_scouts.project_id uuid FK projects`: nullable. Links a scout to an HQ project record. Standalone scouts allowed.

### RLS posture

VS Pro: `FOR ALL USING true WITH CHECK true` on every table.
HQ port: `FOR ALL TO authenticated USING (true) WITH CHECK (true)` on every `vs_*` table. Same precedent as Phase 4.1.1 main-branch decision. Collaborative model: any authenticated `@mirrornyc.com` user can read or write any scout.

### Storage buckets

| VS Pro bucket | HQ bucket | Action |
|---|---|---|
| `sourcing-sheets` | `sourcing_sheets` | **Lift.** HQ already has this bucket from Phase 4.4. Underscore vs hyphen: HQ convention is underscore. |
| `venue-photos` | `vs_venue_photos` (bucket) | **Lift.** Rename for HQ `vs_` prefix consistency. |
| (VS Pro has no briefs bucket) | `briefs` | HQ already has this bucket. Used for brief PDFs uploaded by the producer during scout creation. |

VS Pro's `venue-photos` is public; HQ's should be private with signed URLs (1-hour TTL for inline rendering, like HQ's other buckets). The `vs-generate-deck` port (Phase 4.6-port) signs photo URLs at slide-population time rather than relying on public bucket access.

---

## 3. Frontend pages: port classification

13 source pages → 13 HQ port files. Most lift. Adapt where HQ's auth + routing require it.

| Source page | HQ target | Action | Notes |
|---|---|---|---|
| `src/pages/Index.tsx` | `src/pages/venue-scout/ScoutIndex.tsx` | **Adapt.** Add `<ProtectedRoute>` wrap, replace anon Supabase calls with the authenticated client. Match HQ's "active / archived disclosure" pattern (Phase 4.2 main-branch nailed this UX even though the data shape diverged). | Sort by `last_touched_at DESC`. Same Archive toggle as Phase 4.2 main; the UX was right, the data was wrong. |
| `src/pages/ComingNext.tsx` | (none) | **Drop.** Phase 3 placeholder in VS Pro. HQ port replaces with real surfaces. | |
| `src/pages/NotFound.tsx` | (existing HQ 404) | **Drop.** HQ has its own 404. | |
| `src/pages/sourcing/SheetPrompt.tsx` | `src/pages/venue-scout/SheetPrompt.tsx` | **Lift.** Binary fork page; no schema or auth dependencies. | |
| `src/pages/sourcing/SheetUpload.tsx` | `src/pages/venue-scout/SheetUpload.tsx` | **Adapt.** Lift the state machine (`idle → uploading → parsing → done | error`). Swap bucket name (`sourcing-sheets` → `sourcing_sheets`). Use `DropZone.tsx` cherry-picked from main rather than VS Pro's inline dropzone. | |
| `src/pages/sourcing/Researching.tsx` | `src/pages/venue-scout/Researching.tsx` | **Adapt.** Lift the loading-screen UI and step list. Swap the synchronous `await fetch(research-venues)` for HQ's pattern: function returns immediately with `EdgeRuntime.waitUntil` doing background work, page subscribes to `vs_scouts.current_step` via Realtime to know when research completes. Add `vs_scouts` to the realtime publication in Phase 4.1-port. | The one place the port intentionally diverges from VS Pro's exact behavior. VS Pro polls by awaiting; HQ subscribes via Realtime. Faster perceived UX, graceful on navigation-away. See § 8.3. |
| `src/pages/sourcing/SourcingReport.tsx` | `src/pages/venue-scout/SourcingReport.tsx` | **Lift.** Matrix table is exactly what we want. Port the contenteditable venue name, the notes modal trigger, the shortlist checkboxes, the bottom sticky bar, all of it. Apply HQ design-system tokens (`bg-surface-alt`, `text-muted-foreground`, `--primary` coral). | The biggest single file in the port. ~600 lines. |
| `src/pages/sourcing/Shortlist.tsx` | `src/pages/venue-scout/Shortlist.tsx` | **Lift.** Same matrix shape with the photo-upload column. Pitch checkboxes replace shortlist. | |
| `src/pages/sourcing/Review.tsx` | `src/pages/venue-scout/Review.tsx` | **Lift.** Card-per-venue layout. Inline editing for every field. | |
| `src/pages/sourcing/Compiling.tsx` | `src/pages/venue-scout/Compiling.tsx` | **Adapt.** Same Realtime-subscription swap as Researching. | |
| `src/pages/sourcing/DeckPrep.tsx` | `src/pages/venue-scout/DeckPrep.tsx` | **Lift.** Drag-to-reorder venue list + per-venue drag-to-reorder photo slots. Both via `@dnd-kit`. | Add `@dnd-kit/core` + `@dnd-kit/sortable` + `@dnd-kit/utilities` to HQ package.json. |
| `src/pages/sourcing/Generating.tsx` | `src/pages/venue-scout/Generating.tsx` | **Adapt.** Same Realtime subscription pattern (already what VS Pro does for this page; consistent with the other AI-runs-in-background pages). | |
| `src/pages/sourcing/ErrorState.tsx` | `src/pages/venue-scout/ErrorState.tsx` | **Lift.** Three error configs (`empty-sheet`, `parse-fail`, `research-timeout`). Add `deck-generation-failed` for Phase 4.6-port parity with the failed-attempt's error code. | |

**Add new (HQ-only, no VS Pro analog):** `src/pages/venue-scout/NewScout.tsx` for the "create a new scout" entry point. VS Pro has no equivalent (it has `/projects/new` as a placeholder). HQ port writes this fresh: it's a thin wrapper that INSERTs a `vs_scouts` row with required fields (client_name, event_name) and routes to `/scouts/:id/brief`. Producer fills the rest of the brief from there. **Action: rewrite from scratch**, no source to lift from.

---

## 4. Components

VS Pro has three component groups: `layout/` (AppShell, TopNav, PageHeader), `sourcing/` domain components, and `ui/` (shadcn primitives).

| VS Pro component | HQ target | Action | Notes |
|---|---|---|---|
| `components/layout/AppShell.tsx` | `src/components/AppShell.tsx` (existing) | **Drop.** HQ has its own. | |
| `components/layout/TopNav.tsx` | `src/components/TopNav.tsx` (existing) | **Drop.** HQ has its own with Mirror branding and `VENUES` caption. | |
| `components/layout/PageHeader.tsx` | (none yet) | **Lift.** HQ doesn't have a canonical PageHeader; VS Pro's is small and useful. Add to `src/components/ui/`. | Reused across all 13 VS surfaces. |
| `components/sourcing/NotesModal.tsx` | `src/components/venue-scout/NotesModal.tsx` | **Adapt.** Switch from `AlertDialog` to `Dialog` (lesson from the failed Phase 4.4 hot patch: AlertDialog is wrong for freeform editors; blocks Escape and overlay dismissal). | |
| `components/sourcing/PhotoUploadModal.tsx` | `src/components/venue-scout/PhotoUploadModal.tsx` | **Lift.** 4-slot grid with drag-to-reorder. Swap bucket name. | Most complex single component in the port. |
| `components/sourcing/matrix/primitives.tsx` | `src/components/venue-scout/matrix/primitives.tsx` | **Lift.** `CANONICAL_TYPES`, `parseTypes`, `canonicalizeType`, `TYPE_STYLES`, `rankBucket`, `Th`/`Td`/`VStack`/`HdrStack`, `Pill`, `Bullets`, `RankDisplay`, `EditableVenueName`, `WebsiteArrow`, `NotesCellButton`. All canonical, well-built, zero changes needed. | Apply HQ tokens (`bg-input` for the rank bar, not `bg-secondary`, per the design-system §12 rule). |
| `components/ui/*` (47 shadcn files) | (existing HQ `src/components/ui/`) | **Drop.** HQ has its own copies. | |
| `components/NavLink.tsx` | (drop) | **Drop.** Unused in current VS Pro router setup. | |

---

## 5. lib / hooks

| VS Pro file | HQ target | Action | Notes |
|---|---|---|---|
| `lib/utils.ts` (`cn()`) | (existing `src/lib/utils.ts`) | **Drop.** HQ has it. | |
| `lib/format.ts` | `src/lib/venue-scout/format.ts` | **Lift.** `relativeTime`, `statusPill`, `ProjectStep` type, `stepToRoute`, `isInProgress`. The state-machine helpers in particular drive every page's continue logic. | Rename `ProjectStep` → `ScoutStep` to match the scout vocabulary. |
| `hooks/use-mobile.tsx` | (existing) | **Drop.** HQ has its own. | |
| `hooks/use-toast.ts` | (existing) | **Drop.** HQ uses Sonner. | |

**Add new HQ-only helpers** (rewrite from scratch in Phase 4.1-port):

- `src/lib/venue-scout/scoutQuery.ts`: typed wrapper for the common scout-load query (scout + brief + venues join), since HQ surfaces all need this.
- `src/lib/venue-scout/computeScoutName.ts`: auto-derives `${client_name} - ${event_name}` like the failed Phase 4 did. The producer can override via Scout Settings (later sub-phase).

---

## 6. Edge functions

VS Pro has four edge functions, all self-contained (no `_shared/` module in VS Pro). HQ port wires each through `_shared/anthropic.ts` (`callClaude` wrapper) and uses HQ's service-account auth pattern. All four functions get explicit `verify_jwt` settings in `supabase/config.toml`.

| Source function (lines) | HQ target | Action | Notes |
|---|---|---|---|
| `parse-sheet/index.ts` (~120) | `vs-parse-sheet` | **Lift.** Same XLSX/CSV parsing via `npm:xlsx`. Same fuzzy-pick header matching. Swap bucket name. Add `scout_id`-namespace check on storage path (security lesson from failed Phase 4.4). `verify_jwt = true` (browser-invoked, synchronous). | |
| `research-venues/index.ts` (~330) | `vs-research-venues` | **Adapt.** Lift the entire AI logic + tool schema + system prompt. Three deltas: (1) replace raw `fetch(api.anthropic.com)` with `callClaude('venue_scout', ...)` for HQ's spend tracking + caching. (2) Replace `verify_jwt = true` + browser-await with `verify_jwt = true` + `EdgeRuntime.waitUntil` so the function returns the round_id immediately and the page subscribes to status via Realtime. (3) Strip listing-database hosts from `website_url` via the server-side sanitizer (lesson from failed Phase 4.4 URL-quality hot patch: schema description + sanitizer is the right lever, not system-prompt edits). | Pin to `claude-sonnet-4-5` per the existing memory note (web_search degradation on sonnet-4-6, revert when upstream stabilizes). |
| `compile-summaries/index.ts` (~280) | `vs-compile-summaries` | **Adapt.** Same two-pass logic (fill missing fields for manual venues + always generate venue_overview). Same canonical-type sanitization. Wire through `callClaude`. | |
| `generate-deck/index.ts` (~566) | `vs-generate-deck` | **Adapt.** Lift the Google Slides template-copy + per-venue duplication + token replacement + image insertion logic verbatim. Replace VS Pro's inline JWT-mint with HQ's `_shared/googleServiceAccount.ts` (cherry-picked from the failed Phase 4.6 main-branch). | This is the most code by far. Google Slides + Drive API auth + bytes shuffling. |

**Shared modules to introduce:**

- `_shared/anthropic.ts`: already exists in HQ. Cherry-pick the `tools` + `tool_choice` extension from failed Phase 4.4 main-branch when porting `vs-research-venues`.
- `_shared/venueTypes.ts`: server-side mirror of the canonical types + `canonicalizeType` + `sanitizeWebsiteUrl`. Cherry-pick from failed Phase 4.4 main-branch when porting `vs-research-venues` and `vs-parse-sheet`.
- `_shared/googleServiceAccount.ts`: generic JWT helper with scope-keyed token cache. Cherry-pick from failed Phase 4.6 main-branch when porting `vs-generate-deck`. Wraps the existing `_shared/gmailServiceAccount.ts` pattern for the wider scope list (Slides + Drive).

---

## 7. External dependencies

**Already in HQ** (no add needed):

- Anthropic Claude API (via `callClaude` wrapper).
- Google service account (`mirror-ny-hq-backend@mirror-nyc-hq.iam.gserviceaccount.com`). Has `gmail.readonly`, `gmail.send`, `drive`, `presentations` scopes. `drive` + `presentations` are exactly what `vs-generate-deck` needs.
- Supabase (Postgres, Auth, Storage, Edge Functions, Realtime).
- Tailwind + shadcn/ui.
- React Router 6.30.

**Add to HQ's `package.json`** when porting Phase 4.5-port (Shortlist) or Phase 4.6-port (DeckPrep):

- `@dnd-kit/core`
- `@dnd-kit/sortable`
- `@dnd-kit/utilities`

Tagged version pinning. VS Pro pins these; lift the exact versions to avoid drift.

**Secrets to verify on HQ Supabase project:**

- `GOOGLE_TEMPLATE_FILE_ID`: VS Pro deck template ID. May need re-export to HQ's Workspace and a new ID.
- `GOOGLE_OUTPUT_FOLDER_ID`: Drive folder for generated decks. May need creation in HQ's Workspace.
- `ANTHROPIC_API_KEY_VS`: already used by HQ for `vs-parse-brief`. Confirm still set.

---

## 8. Locked decisions

Six decisions confirmed by Jimmie 2026-05-11. The body of this plan reflects each one throughout. Body cross-references to § 8 #N point here.

### 8.1 Single-round sourcing per scout

One scout has one sourcing flow. No `vs_sourcing_rounds` table. Matches VS Pro 1:1. If a producer needs to re-research, they use Start Over (Settings page, Phase 4.9-port), which wipes the candidate pool and resets `current_step` to `sheet_prompt`. Worth revisiting only if real producers ask for multi-round, not before.

### 8.2 Brief inline on `vs_scouts`

No separate `vs_briefs` table. All brief fields live on `vs_scouts`: named columns for `client_name`, `event_name`, `live_dates`, `city`, `budget`, `event_overview`, plus `brief_data jsonb` for flexible additional fields per VS Pro's shape. Simpler queries, fewer joins, matches the state-machine model where the brief belongs to the scout.

### 8.3 `EdgeRuntime.waitUntil` + Realtime for Researching, Compiling, Generating

All three loading pages subscribe to `vs_scouts.current_step` via Realtime instead of awaiting the edge function response synchronously. Edge functions return the scout_id immediately and run the AI work in the background. Requires `vs_scouts` in the `supabase_realtime` publication with `REPLICA IDENTITY FULL` (one line in the Phase 4.1-port migration). The only place the port intentionally diverges from VS Pro's exact behavior; consistent with HQ's `ts-final-review` pattern.

### 8.4 `current_step` state machine as canonical workflow state

9 values lifted verbatim from VS Pro: `sheet_prompt`, `sheet_upload`, `researching`, `sourcing_report`, `shortlist`, `review_selects`, `compiling`, `deck_prep`, `completed`. No `phase` enum concept. `stepToRoute()` helper from `src/lib/venue-scout/format.ts` drives every page's continue logic.

### 8.5 Deck history as `vs_scouts.generated_decks jsonb` array

No separate `vs_pitch_decks` table. Each entry: `{deck_id, deck_name, version, generated_at, venue_count, slide_count, edit_url, embed_url}`. Matches VS Pro exactly. The deck history is small (typically 1-3 versions per scout), access pattern is "give me all decks for this scout," no query against deck fields. The jsonb array embeds cleanly in the scout-load query.

### 8.6 RLS open to all authenticated users

`FOR ALL TO authenticated USING (true) WITH CHECK (true)` on every `vs_*` table. Collaborative model: any authenticated `@mirrornyc.com` user can read or write any scout, candidate venue, or photo. Venue Scout is an agency-wide workflow, not personal data scoped to a single producer.

---

## 9. Suggested port sequence

Sub-phases stack so each one compiles and ships end-to-end before the next begins. Slimmest-to-thickest. Each sub-phase is one commit (squash-merged from a `claude/*` worktree, same flow as Phase 3).

### Phase 4.1-port: schema augmentation + port plan landing

- Migration: `DROP TABLE IF EXISTS vs_*` for the failed-attempt shapes, then CREATE the four port tables (`vs_scouts`, `vs_candidate_venues`, `vs_venue_photos`) with the ported schema. RLS, GRANTs, triggers, `supabase_realtime` publication membership for `vs_scouts`.
- Cherry-pick the `_shared/anthropic.ts` tools extension and `_shared/venueTypes.ts` server-side mirror (no edge function lands yet; this primes the shared modules).
- First commit on `vs-port-fresh` also lands `docs/venue-scout-port-plan.md` (this file).

**End-user win:** schema is in place. Nothing renders yet.

### Phase 4.2-port: Scout Index + New Scout

- Port `src/pages/Index.tsx` → `ScoutIndex.tsx` with HQ auth wrap, active/archived bucket UI lifted from failed Phase 4.2 main UX (the layout was right, only the data shape was wrong).
- Port the New Scout entry point. Rewrite from scratch since VS Pro's placeholder is unusable.
- Top nav `Venue Scout` link.

**End-user win:** producers can create a scout and see the list.

### Phase 4.3-port: Brief

- Port the brief surface. VS Pro doesn't have a polished brief page (it's a Phase 3 stub); lift the `brief_data jsonb` shape and design the form against the HQ design system from scratch. Keep all brief fields flat on `vs_scouts` per § 8.2.
- Producer fills brief, clicks Continue, scout `current_step` moves to `sheet_prompt`.

**End-user win:** brief intake works end-to-end. Producer can save a brief.

### Phase 4.4-port: Sheet Prompt + Sheet Upload + parse-sheet

- Port `SheetPrompt.tsx` (binary fork) and `SheetUpload.tsx` (DropZone + state machine).
- Port `parse-sheet/index.ts` → `vs-parse-sheet`. `verify_jwt = true`, synchronous, scout-namespace check on storage path.

**End-user win:** producer can upload a sheet and see venues land in their candidate pool.

### Phase 4.5-port: Researching + research-venues

- Port `Researching.tsx` with `EdgeRuntime.waitUntil` + Realtime swap per § 8.3.
- Port `research-venues/index.ts` → `vs-research-venues`. Wire through `callClaude`, sanitize URLs server-side, pin model to `claude-sonnet-4-5`.

**End-user win:** AI research kickoff works end-to-end. Producer sees venues populate the candidate pool from research.

### Phase 4.6-port: Sourcing Report (Matrix) + Shortlist + matrix primitives

- Port `matrix/primitives.tsx` verbatim with HQ tokens applied.
- Port `SourcingReport.tsx`. Inline venue-name edit, notes modal, shortlist checkboxes, bottom sticky bar.
- Port `Shortlist.tsx`. Same matrix shape with photo-upload column.

**End-user win:** producer can review candidates, shortlist, and pitch. Photo upload is stubbed until 4.7-port.

### Phase 4.7-port: Review + PhotoUploadModal + NotesModal + Compile

- Port `Review.tsx` (card-per-venue with full inline editing).
- Port `PhotoUploadModal.tsx` and `NotesModal.tsx`.
- Port `Compiling.tsx` and `compile-summaries/index.ts` → `vs-compile-summaries`. Wire through `callClaude`.

**End-user win:** producer can review final selections, edit every field inline, upload photos, and trigger summary compilation.

### Phase 4.8-port: Deck Prep + Generate + generate-deck

- Port `DeckPrep.tsx` (drag-to-reorder venues + drag-to-reorder photo slots, both `@dnd-kit`).
- Port `Generating.tsx` with the Realtime subscription pattern.
- Port `generate-deck/index.ts` → `vs-generate-deck`. Cherry-pick `_shared/googleServiceAccount.ts` from failed Phase 4.6 main.
- Verify `GOOGLE_TEMPLATE_FILE_ID` and `GOOGLE_OUTPUT_FOLDER_ID` are set on HQ's Supabase project.

**End-user win:** producer can generate a Google Slides deck end-to-end. Full VS Pro workflow now functional in HQ.

### Phase 4.9-port: Settings + Start Over + Error States

- Add Scout Settings page (rename, project link, Start Over). Same as failed Phase 4.3.4 main; the spec was sound, the data model is now simpler.
- Port `ErrorState.tsx` with the three error configs + a fourth for `deck-generation-failed`.

**End-user win:** producer can rename, link to HQ project, start over, and recover from errors.

### Phase 4.10-port: Polish + UX pass

- One consolidated UX + visual review against VS Pro side-by-side. Surface every divergence; decide which are bugs and which are intentional improvements.
- Apply Mirror brand polish (this is where the "HQ styling from the start" approach pays off; polish should be small).

**End-user win:** Venue Scout is shipped and matches Mirror brand.

---

## 10. Carry-forward from main (cherry-pick lazily during the port)

When each item becomes relevant in a sub-phase, cherry-pick the corresponding commit from main:

| Cherry-pick when porting... | Commit | Description |
|---|---|---|
| Phase 4.1-port (schema augmentation) | (cherry-pick after Phase 4.1-port lands) `cf6d668` | `docs/conventions.md` AlertDialogAction async-close gotcha. Single-line addition; apply when first VS port surface uses AlertDialog with an async action (probably Phase 4.9-port Settings Start Over). |
| Phase 4.5-port (`vs-research-venues`) | failed Phase 4.4 commit | `_shared/anthropic.ts` tools + tool_choice extension. Additive, no regression. |
| Phase 4.5-port (`vs-research-venues`) | failed Phase 4.4 commit | `_shared/venueTypes.ts` server-side mirror with `canonicalizeType`, `sanitizeWebsiteUrl`, and the search-page pattern detection from the URL-quality hot patch. |
| Phase 4.8-port (`vs-generate-deck`) | failed Phase 4.6 commit | `_shared/googleServiceAccount.ts` generic scope-keyed JWT helper. |
| Whenever first wizard ports | `4a8a5c6` | TS Stepper backport. Replaces the local `src/components/talent-scout/Stepper.tsx` (fixed 3-step) with `src/components/ui/Stepper.tsx` (canonical, arbitrary `steps`). The new HQ wizard surfaces (if any) use the canonical one. |

The other commits on main that landed during the failed Phase 4 attempt (Phase 4 build-through mode codification, doc audit cleanup, `mirror-style-guide.md` relocation) are optional. Cherry-pick whichever pieces stay relevant; skip the rest.

---

## Done when

The 10 sub-phases above land on `vs-port-fresh`. Then:

- Hard-reset main to `vs-port-fresh` HEAD as a single cutover (preferred for a clean main history) OR squash-merge as one big "Phase 4: Venue Scout port" commit (preserves the failed-attempt history below it).
- Delete the five orphaned edge functions on production: `vs-parse-brief`, `vs-parse-sheet`, `vs-start-sourcing`, `vs-compile-summaries`, `vs-generate-deck` (all from the failed attempt; the new port replaces them).
- Drop the abandoned `vs_briefs`, `vs_sourcing_rounds`, `vs_pitch_decks` tables in production if they were left in place per the Code-recommended Option A (one cleanup migration on the new main).
- Update `docs/roadmap.md`, `CHECKPOINT.md`, `docs/decisions.md` to reflect the port-completed state. The roadmap's failed Phase 4 entries become "Abandoned, replaced by Phase 4-port."

---

## Voice + style for the port

Each sub-phase commits with the message `Phase 4.X-port: <title>` (e.g. `Phase 4.5-port: Researching + research-venues`). The `-port` suffix distinguishes from the abandoned main-branch Phase 4 commits.

The wireframe at `~/Documents/Claude/Projects/Venue Sourcing App/wireframe/index.html` is NOT consulted for the port. VS Pro is the only layout authority. Open VS Pro side-by-side with the port branch in dev; match the data displayed and the layout structure 1:1. HQ design system tokens get applied as each surface ports (`bg-surface-alt` for cards, coral `--primary`, `text-muted-foreground`, `font-display` for h1's, the four sticky-bar patterns, etc.).

If a port surface looks meaningfully different from VS Pro after the design-system pass, that's a bug, not a feature. Flag and reconcile before shipping the sub-phase.
