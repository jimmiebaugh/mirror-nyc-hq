# HQ Design System

The applied patterns Talent Scout established that every new HQ surface (Phase 4 Venue Scout, Phase 5 Cross-cutting, anything beyond) builds on. **This is the canonical reference for new surface design.**

For the brand authority, see `docs/mirror-style-guide.md`. This doc is forward-looking: "I'm building a new HQ page; what's the pattern?"

---

## 1. Tokens (locked in `src/index.css`)

Every new surface uses these. Don't introduce new ones unless approved.

### Color

| Token | HSL | Hex | Use |
| --- | --- | --- | --- |
| `--background` | `0 0% 0%` | `#000` | Page background (full black) |
| `--surface` | `0 0% 4%` | `#0A0A0A` | Default card surface |
| `--surface-alt` | `0 0% 8%` | `#141414` | **Card surface for sectioned content (`bg-surface-alt`)** |
| `--surface-raised` | `0 0% 12%` | `#1F1F1F` | Popovers, dropdowns, top-elevation overlays |
| `--input` | `0 0% 16%` | `#2A2A2A` | Input borders AND track backgrounds (slider, score bar) |
| `--border` | `0 0% 16%` | `#2A2A2A` | Hairline dividers |
| `--border-strong` | `0 0% 23%` | `#3A3A3A` | Input outlines, stronger dividers |
| `--primary` | `4 47% 51%` | `#BE4E44` | Mirror coral: eyebrows, primary CTAs, R-pill, focus rings |
| `--primary-hover` | `4 53% 56%` | `#CC5C52` | Coral hover state |
| `--muted-foreground` | `0 0% 78%` | `#C8C8C8` | Secondary text |
| `--subtle-foreground` | `0 0% 54%` | `#8A8A8A` | Tertiary text, captions |
| `--destructive` | `0 84% 60%` | `#EF4444` | Tier 1 must-haves, Failed pills, errors |
| `--success` | `142 76% 64%` | `#4ADE80` | Tier 3, Latest pill, Final review complete |
| `--warn` | `38 92% 50%` | `#F59E0B` | Running, Stalled, dirty-state indicators |
| `--info` | `189 94% 43%` | `#06B6D4` | Cyan status (In Progress, Install, Likely). Exposed as Tailwind `info` |
| `--purple` | `268 86% 72%` | `#B57BF5` | Purple status (Removal, Vendor affiliation). Exposed as Tailwind `purple` |

**Gotcha:** slider track + score-bar track must be `bg-input` (not `bg-secondary`). On `bg-surface-alt` cards both share `#141414`, making `bg-secondary` invisible. Phase 3.5/3.7 cost us multiple sessions catching this. See `src/components/ui/slider.tsx` and `src/components/talent-scout/ScoreInline.tsx`.

### Type

Three families:
- **Montserrat ExtraBold** (`var(--font-display)`): page titles, eyebrows, brand wordmark, criterion names
- **Roboto Mono** (`var(--font-mono)`): labels, captions, status pills, breadcrumb, "TIER 1: MUST-HAVES"
- **Roboto** (`var(--font-body)`): body text, form inputs, narrative content

Sizes (utility classes in `src/index.css`; values below match the shipped CSS, which is canonical):
- `.h-page`: page title (`text-[34px] font-display font-extrabold uppercase`)
- `.h-section`: section header inside a card (`text-[22px] font-display font-extrabold uppercase`)
- `.h-card`: in-card title on dashboards + `card-headbar` headers (`text-[18px] font-display font-extrabold`)
- `.label-section`: section eyebrow (`text-[13px] font-mono uppercase tracking-[0.08em]`, **grey** `muted-foreground`)
- `.label-form`: form-field label (`text-[12px] font-mono font-bold uppercase tracking-[0.06em]`, **grey** `subtle-foreground`)
- `.eyebrow`: coral eyebrow above a title (`text-[14px] font-mono font-bold uppercase tracking-[0.08em] text-primary`)
- `.crumb`: back-link breadcrumb (`text-[12px] font-mono font-medium uppercase tracking-[0.08em] text-primary hover:underline`)
- `.detail-meta`: detail-page caption row under the page title (`text-[14px] font-mono tracking-[0.06em] text-muted-foreground`, mixed-case, joined with `·` bullets). Sits between `.h-page` and the card stack with **8px top margin** (consistent across Project / Venue / Vendor / Person). Wraps base `.pill` pills inline in the same `.row-c` container (not `.pill-lg`, so pill height stays close to the 14px text line).

**Form + section labels are grey, not coral** (Phase 5.10.1; coral is reserved for links / CTAs per `feedback_coral_reserved_for_hyperlinks`). The single exception: Talent Scout and Venue Scout page-form Fields keep an inline coral label by deliberate per-module choice.

**VS coral-label exception scope** (audit pass 2, item 8): the coral label exception applies to **per-field form labels rendered through the VS page-form `Field` helper only** (e.g. the local `Field` in `BriefEvent.tsx` / `BriefVenue.tsx` / `ScoutSettings.tsx` / `NewScout.tsx`; canonical pattern in § 3). **Section headers** above a Field group and **detail-card field labels** (e.g. `BriefReportCard`, `ReviewCard`'s `CardField`) flip to grey via `.label-section` (13px) or `.label-form` (12px), NOT coral.

**Page titles are ALL CAPS** (deck-canonical). Button labels stay sentence/title case (uppercase reads too presentational).

### Spacing + radius

- `--radius: 0.25rem` (4px): every rounded element
- Card content padding: `p-6` (24px) standard, `p-8` for forms
- Card to card gap: `space-y-6` (24px)
- Form-field stack: `space-y-2` per Field, `space-y-4` per group, `space-y-6` between sections
- Sticky bottom action bar: `py-4 px-6` with `border-t-2 border-primary/40`

**Component sizing** (canonical; promoted from `mirror-style-guide.md` during the Phase 5 reconciliation):

- **Button height:** 40px for primary and secondary, 36px for tertiary.
- **Input height:** 44px.
- **Card title (h3) size:** 18px Montserrat ExtraBold. Distinct from `.h-section` (22px shipped); use `.h-card` for in-card titles on dashboards and table headbars. `.h-card` is defined in `src/index.css` under the Phase 5.1 HQ Core block.

---

## 2. Layout primitives

### Page wrapper

```jsx
<div className="mx-auto max-w-3xl space-y-6">  // forms / detail pages
<div className="mx-auto max-w-4xl space-y-6">  // wizards
<div className="mx-auto max-w-7xl space-y-6">  // role settings (2-col grid)
```

Page widths anchor on content type. Match the existing surface closest to what you're building:
- Settings, Detail forms → `max-w-3xl`
- Wizards (multi-step) → `max-w-4xl`
- Edit-Role-style 2-column grids → `max-w-7xl`

### Page header

Standard pattern (Phase 5.12.14: caption `<p>` dropped from the canon; if a page needs instruction copy, use the `.hq-explainer` block below the breadcrumb-stepper, not the header):

```jsx
<header className="space-y-2">
  <Link to={backTo} className="crumb">
    ← Back to {parent}
  </Link>
  {/* Venue Scout pages: ScoutPhaseBreadcrumb sits between the crumb and the eyebrow */}
  <div className="eyebrow">{PHASE_LABEL}</div>
  <h1 className="h-page">{Title}</h1>
</header>
```

Reference: `src/pages/talent-scout/Settings.tsx`, `RoleSettings.tsx`. Venue Scout reference: `src/pages/venue-scout/BriefEvent.tsx` (uses the `ScoutPhaseBreadcrumb` between the crumb and the eyebrow per the Phase 5.12.14 chrome canon).

### Explainer block (Phase 5.12.14)

Page-level instruction copy lives in the `.hq-explainer` design-system block, NOT in the page header. Single class set in `src/index.css` under the "Phase 5.12.14 HQ Core surfaces" block:

```jsx
<div className="hq-explainer">
  <div className="hq-explainer-label">{label || "Guidance"}</div>
  <p className="hq-explainer-body">{copy}</p>
</div>
```

Position: below the breadcrumb-stepper (when present), above the first content card. Optional per-page. v1 consumers (2026-05-25): `BriefEvent` (PDF pre-fill tip above the upload card), `Review` (notes-driven regenerate explainer above the venue card grid).

### HQ Core detail page canon

HQ Core detail pages use a shared header and field rhythm:

- Back link uses `className="crumb"` with the small arrow icon.
- Header stack is `.eyebrow`, plain `.h-page` title, optional hero pill next to the title, then `.detail-meta` with 8px top margin.
- `.detail-meta` values are truthy-only and joined with `·`; do not render placeholder bullets.
- Card fields use `src/components/hq/DField.tsx`, label above value, and row dividers between logical groups.
- Schedule dates use `formatShortDate()`. Completion and historical dates keep the year with `formatMediumDate()`.
- Task and Deliverable are compact-record exceptions: they stay single-column `maxWidth: 760`, but still use eyebrow, plain title, detail-meta, hero status pill, and `DField` rows.
- ProjectDetail uses `detail-2col--wide` as the deliberate wide-detail exception.

Standalone relationship cards use `combo-as-link` in the card headbar, hide in-trigger multi-value chips, and render the selected records as bullet-separated coral links in the card body. Field-level lookups use inline chips or the normal combobox display. ProjectDetail Vendors is the documented exception because its sidebar add-Popover is more discoverable for that workflow.

### Card surfaces

Sectioned content always lives in a `bg-surface-alt` Card.

```jsx
<Card className="bg-surface-alt">
  <CardContent className="space-y-3 p-6">
    <div className="space-y-1">
      <div className="label-section">Section Title</div>
      <p className="text-xs text-muted-foreground">{description}</p>
    </div>
    {/* content */}
  </CardContent>
</Card>
```

For cards with their own internal header bar (used for Scorecard editor, master pool table), the header is a `flex items-center justify-between gap-3 border-b border-border px-6 py-4` row inside a `flex-col` Card.

Reference: `src/pages/talent-scout/RoleSettings.tsx` (Scorecard card), `src/components/talent-scout/CandidateTable.tsx` (in-card title).

---

## 3. Form patterns

### Field component (canonical primitives)

Two distinct field primitives, by surface type:

- **`src/components/venue-scout/VSPageField.tsx`** — Venue Scout (and Talent Scout) page-form fields. Coral 12px mono uppercase label. Use for any new VS page-form. Phase 5.12.14.1 Stage 2C extraction; replaced 4 local `Field` helpers in NewScout / BriefEvent / BriefVenue / ScoutSettings.
- **`src/components/ui/Field.tsx`** — matrix-cell variant (smaller label). Use inside matrix cells.

VSPageField signature:

```jsx
export function VSPageField({ label, required, children }: {
  label: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label className="text-xs font-mono font-bold uppercase tracking-wider text-primary">
        {label}
        {required && <span className="ml-1 text-primary">*</span>}
      </Label>
      {children}
    </div>
  );
}
```

Required marker is a coral asterisk. Always.

**Label color:** the `text-primary` (coral) label above is the Talent Scout / Venue Scout page-form convention. HQ Core form labels use `.label-form` (grey `subtle-foreground`) per the Phase 5.10.1 coral-reservation rule. New HQ Core surfaces use grey; the coral label is the TS/VS exception.

The VS coral exception is scoped to **per-field Field labels only**. Section headers above a Field group (e.g. "Project" / "Logistics" / "Event" / "Venue") and detail-card field labels (e.g. `BriefReportCard`, `ReviewCard`'s `CardField`) render grey via `.label-section` (13px) or `.label-form` (12px). See § 1 for the canonical scope statement.

### Inputs

shadcn/ui primitives first: `Input`, `Textarea`, `Select`, `RadioGroup`, `Checkbox`, `Slider`. No custom inputs unless a real gap.

Keyword/tag input is custom: `src/components/talent-scout/TagInput.tsx`. Reuse for any "list of strings" field.

### Multi-step wizards

3-step pattern from new-role wizard:
- `<Stepper active={N} />` at the top (`src/components/talent-scout/Stepper.tsx`)
- State persisted in an in-memory store (`src/lib/talent-scout/wizardStore.ts`) so back/forward across steps doesn't lose data
- Each step = its own page route (`/new/details`, `/new/search`, `/new/scorecard`)
- Final "lock + create" step writes the record to DB and navigates to the detail page

Replicated in Venue Scout's brief, research, and deck flow (Phase 4 port; sub-phase narratives in `CHECKPOINT.md` + cutover decisions in `docs/decisions.md`).

### Sticky bottom action bar

```jsx
<div className="sticky bottom-0 z-10 -mx-6 mt-6 border-t-2 border-primary/40 bg-background/90 px-6 py-4 backdrop-blur supports-[backdrop-filter]:bg-background/75">
  <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
    <Button variant="ghost" onClick={cancel}>← Cancel</Button>
    <div className="flex items-center gap-3">
      {dirty && <span className="text-xs font-mono uppercase tracking-wider text-amber-400">Unsaved changes</span>}
      <Button onClick={save} disabled={saving || !dirty}>
        {saving ? "Saving…" : "Save changes"}
      </Button>
    </div>
  </div>
</div>
```

Reference: `RoleSettings.tsx`, `NewRoleScorecard.tsx`.

### HQ Core edit page canon

HQ Core edit pages use `src/components/hq/HQFormField.tsx` for grey `.label-form` labels and the coral required asterisk. `src/components/ui/Field.tsx` remains the Talent Scout / Venue Scout coral-label wrapper.

- Default shell is centered at 880px with `.hq-form`.
- First editable card is titled `Details`.
- Field groups are separated by hairline row dividers.
- TaskEdit and DeliverableEdit use the centered compact shell.
- ProjectEdit intentionally remains full-width because its Team, Links, Vendors, and notes sections need the extra horizontal room.

---

## 4. Tables (CandidateTable is the canonical pattern)

Two-tier pattern: active rows above, rejected rows below collapsible. With status-priority sort and inline status dropdown per row.

Reference: `src/components/talent-scout/CandidateTable.tsx`. **Read this file before building any tabular surface in Phase 4 / 5.** Project lists, venue lists, task lists all map to this pattern with column shape adjusted.

Talent Scout's CandidateTable carries its own select-row + bulk action bar (used for the round-level Re-evaluate / Reject / Promote flow). HQ Core's shared `<DataTable>` does NOT carry row selection; when extending DataTable, don't pattern-match from CandidateTable's bulk action bar.

Column header rules:
- 12px mono uppercase
- Left-aligned for text, right-aligned for numbers, center for status
- Header has a separate row with `bg-surface-alt` border bottom

Row rules:
- Hover: `bg-muted/40`
- Status-color left border (3px solid) per row to surface status at a glance
- Click a row → navigate to detail

### List-page table canon (Phase 5.11.2)

ProjectsList is the reference for HQ Core list pages. All non-Talent / non-Venue Scout list tables should match:

- **Wrapper:** `<DataTable<RowType>` with `flat` (`.tbl--flat`) unless the table actually uses status-color left borders (only TasksList does, via `rowBorderToken`).
- **Primary identifier column:** First (or first major) column renders the entity name with `<Link className="lead">{name}</Link>` so it picks up the canonical 13px-with-foreground-color `.tbl .lead` rule. Use `style={{ fontSize: 13.5 }}` only when the column also carries a stacked secondary line.
- **Stacked secondary identifiers** (e.g. Project / Client, Name / Affiliation): primary on top in `.lead`, secondary line below in `.sub` styled with `style={{ color: "hsl(var(--primary-hover))", fontSize: 12 }}` so the affiliation reads as a coral hyperlink.
- **Date columns:** `formatShortDate()` (MON XX, no year) in `<span className="mono">` so columns share the same numeric ramp.
- **Phone / id columns:** `<span className="muted mono" style={{ fontSize: 12 }}>` to match the size-down on secondary metadata.
- **Status:** centered (`align: "c"`) `<ClickPillCell>` at `pill-sm`. Affiliation pills (Client / Vendor / Venue on People) use the muted `p-aff-*` variants at `pill-sm` so the dense list doesn't read as candy.
- **Action / link buttons** (Website, Slack, etc.): centered (`align: "c"`) `<a className="btn btn-coral btn-sm">` matching the Venues + Vendors + Clients Website column.
- **Empty-state CTA:** `empty={{ message, ctaLabel: "+ New {Entity}", onCta }}`.
- **Count footer:** `<span className="cap">{N} {plural}</span>` below the table.
- **Projects footer exception:** Projects keeps its active count plus hidden terminal-count metadata.
- **Deliverables exception:** Deliverables remains a grouped-list page with no global footer.

When a list table needs to diverge (Talent Scout's CandidateTable two-tier active/rejected; Venue Scout matrices), document the deviation inline near the component with a one-line rationale.

---

## 5. Pills + badges

Status pills are everywhere in HQ. Three sizes:

| Size | Class fragment | Use |
| --- | --- | --- |
| Compact | `h-7 text-[10px] px-2` | Inline next to a name, tight surfaces |
| Default | `h-8 text-[12px] px-2.5` | Status dropdown, pill rows |
| Large | `h-10 text-[16px] px-4 py-2` | Hero pill on detail-page header |

References: `RoundStatusPill.tsx`, `RoleStatusPill.tsx`, `ReferralPill.tsx`, `ReviewedPill.tsx`, `StatusDropdown.tsx`, `SourcePill` (in `src/components/venue-scout/matrix/primitives.tsx`).

**Color rules:**
- Status (running/complete/failed/etc.) → tier-derived color from `mirror-style-guide.md`
- Auto/manual reviewed → muted grey vs solid coral
- Latest / Most-recent indicator → green (success token)
- Reject / DQ → destructive red
- Referral pill → electric blue (NOT coral). Coral was tried in 3.7.8.8, reverted in 3.7.8.13 because too many other coral surfaces blurred the signal.

### Venue Scout SourcePill (4-state, Phase 5.12.1)

Sub-default-size pill rendered at the bottom of `VenueIdentityStack` on the SourcingReport + Shortlist matrices. NOT rendered on DeckPrep (the producer is past the sourcing-origin distinction at deck-prep time). Maps `vs_candidate_venues.source` to a label + a per-state palette.

| Source value | Label | Palette | Inserted by |
| --- | --- | --- | --- |
| `manual` | Manual | electric blue (`bg-blue-400/10 text-blue-300 border-blue-400/30`) | producer typing in the matrix |
| `sheet` | Uploaded | amber (`bg-amber-400/10 text-amber-400 border-amber-400/30`) | `vs-parse-sheet` |
| `hq_pool` | Venues DB | teal (`bg-[rgba(104,168,160,0.18)] text-[#7ECCB8] border-[rgba(104,168,160,0.42)]`) | `vs-research-venues` (Phase 5.12.1 pre-Phase-B HQ pool insert) |
| `research` | Sourced | muted gray (`bg-input text-muted-foreground border-border`) | `vs-research-venues` Phase B Claude pass |

`SOURCE_PRIORITY` in `src/lib/venue-scout/format.ts` orders the matrix sort: manual (0) < sheet (1) < hq_pool (2) < research (3). Tiebreak alphabetical by name. Phase 5.12.1 added the `hq_pool` rank between sheet and research; admin-curated HQ pool sits below producer-uploaded sheets but above AI-sourced. Tune the teal palette in Phase 5.12.7 if the VS visual smoke surfaces a closer brand tone.

---

## 5b. Status color mapping (canonical)

Every status pill, table row left-border, board column dot, and timeline bar in HQ Core resolves to one of these tokens. Mapped per enum.

**Tokens:**

| Token | Hex | Use |
| --- | --- | --- |
| `--success` | `#4ADE80` | green |
| `--info` | `#06B6D4` | cyan |
| `--warn` | `#F59E0B` | amber |
| `--destructive` | `#EF4444` | red |
| `--border-strong` | `#3A3A3A` | neutral / dormant gray |

Coral (`--primary`) is reserved as an accent (primary CTAs, eyebrows, focus rings, primary record links). It is NEVER a status color. The one sanctioned exception: the Deliverables board uses a coral card background (`.bcard--bg-coral`) for ≤7-day deadline urgency (Phase 5.7.5 decision); this is a deliberate, isolated use, not a precedent for coral status pills.

### Project status (14 values)

| Status | Token |
| --- | --- |
| Approved | `--success` |
| In Production | `--info` |
| In Progress | `--info` |
| Location Scouting | `--info` |
| Install | `--info` |
| Removal | `--warn` |
| Billing | `--warn` |
| Queued | `--border-strong` |
| Quoting | `--warn` |
| Quote Sent | `--warn` |
| Awaiting Feedback | `--warn` |
| On Hold | `--border-strong` |
| Complete | `--border-strong` |
| Cancelled | `--destructive` |

**Billing is amber, not green.** The locked wireframe Surface 04 renders Billing rows green; that is a wireframe-side inconsistency carrying into the spec. Build enforces amber.

### Task status (4 values)

| Status | Token |
| --- | --- |
| To Do | `--border-strong` |
| Doing | `--info` |
| Blocked | `--destructive` |
| Done | `--success` |

### Deliverable status (4 values)

| Status | Token |
| --- | --- |
| Upcoming | `--border-strong` |
| In Progress | `--warn` |
| Complete | `--success` |
| Skipped | `--border-strong` (with strikethrough text and reduced opacity) |

Upcoming and Skipped share the gray token. Skipped differentiates with `text-decoration: line-through` and `opacity-60` on the title text, matching the Done task render in the wireframe.

### Outlook Confidence (4 values)

| Status | Token |
| --- | --- |
| On Radar | `--warn` |
| Likely | `--info` |
| Confirmed | `--success` |
| Complete | `--border-strong` |

Reads as a step-up ladder: speculative (amber), looking good (cyan), locked (green), done (gray). This flips the wireframe's drawn mapping for Outlook Confidence; build enforces this version.

Implementation pointer: `src/lib/home/projectStatusToken.ts` is the canonical mapper for the Project + Task enums; `.pill.p-<token>` classes in `src/index.css` render the resolved color.

---

## 6. Dialogs (`AlertDialog` from shadcn/ui)

For destructive actions, multi-step confirmations, unsaved-changes leave gates.

```jsx
<AlertDialog open={open} onOpenChange={setOpen}>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>{question}</AlertDialogTitle>
      <AlertDialogDescription>{consequences}</AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel>Cancel</AlertDialogCancel>
      <AlertDialogAction onClick={confirm}>Confirm</AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
```

Reference patterns:
- Re-eval triggering save: `RoleSettings.tsx` `confirmReevalOpen`
- Unsaved-changes leave gate: `RoleSettings.tsx` `confirmLeaveOpen`
- Close-role action: same file

The dialog body should always state the consequence ("This will overwrite N candidate evaluations") rather than just asking yes/no.

---

## 7. Loading + empty states

### Loading

Centered Loader2 spinner + heading + caption:

```jsx
<div className="flex flex-col items-center gap-4 py-24 text-center">
  <Loader2 className="h-8 w-8 animate-spin text-primary" />
  <div>
    <div className="text-xl font-semibold">{What's loading}</div>
    <p className="mt-2 max-w-md text-sm text-muted-foreground">{Why this might take a sec}</p>
  </div>
</div>
```

Reference: `NewRoleScorecard.tsx`.

### Empty

When a list / table has zero rows:

```jsx
<div className="rounded-md border border-dashed border-border py-12 text-center">
  <p className="text-sm text-muted-foreground">{No items copy}</p>
  <Button variant="outline" className="mt-4" onClick={primaryAction}>{Primary action}</Button>
</div>
```

Match the surrounding card surface. Empty state in a `bg-surface-alt` card uses the same dashed-border pattern.

---

## 8. Toasts

Default toast = solid Mirror coral with white bold text (Sonner + Radix Toast both default to coral). Phase 3.7.8 standardization.

Use destructive variant only for genuine failures (save errors, API errors). For action confirmations / status updates, default coral toast.

Reference: `src/components/ui/sonner.tsx`, `src/components/ui/toast.tsx`.

Pattern:
```jsx
toast({ title: "Saved" });                                    // success / confirmation
toast({ title: "Saved · re-evaluation started" });            // multi-part status
toast({ title: "Save failed", description: err.message,       // failure
        variant: "destructive" });
```

Title is short (≤ 4 words). Description carries detail. Don't put error stacks in the toast: `console.error` those, surface a clean message.

---

## 9. Behavioral patterns

These are the bigger-picture interaction patterns Talent Scout established.

### Dirty-state tracking + sticky save

Form pages track `dirty = JSON.stringify(initial) !== JSON.stringify(form)`. Save button is disabled when not dirty. Sticky save bar shows "Unsaved changes" indicator when dirty. Cancel button gates with confirm-leave dialog if dirty.

Reference: `RoleSettings.tsx` (`isFormDirty`, `confirmLeaveOpen`, the sticky save bar).

### Two-button morph (Process / Save or Process / Lock)

Phase 3.10 pattern. When a form has TWO kinds of dirty work (a refinement that needs an AI pass, then a save), the action button morphs:
- Edits made since last AI pass → button reads "Process scorecard" → runs AI refinement
- Once clean (no edits since last AI pass) → button flips to "Save changes" / "Lock scorecard"

Reference: `NewRoleScorecard.tsx`, `RoleSettings.tsx` `scorecardEditedSinceRefine` flag.

### Confirm-on-destructive-save

Saves that trigger downstream re-evaluation (changing JD / hiring priorities / scorecard / evaluation prompt) open an explanatory dialog before the DB write. The dialog body explains exactly what will be overwritten downstream.

Reference: `RoleSettings.tsx` `requestSave` → `confirmReevalOpen`.

### Realtime subscriptions for in-flight state

Long-running operations (pull rounds, final reviews) update DB rows live; UI subscribes via Supabase Realtime `postgres_changes` on the row. No polling.

Tables that need this: `REPLICA IDENTITY FULL` + add to `supabase_realtime` publication in the migration. See `docs/schema.md` Realtime section.

Reference: `PullDetail.tsx` (round status), `FinalReviewLoading.tsx` (step_progress).

### Auto-save vs explicit-save

Talent Scout uses **explicit save** universally (sticky save bar). Internal Notes on CandidateDetail is the one auto-save (debounced) because it's a freeform editor and forcing a save click breaks flow. Default to explicit.

### Optimistic vs server-confirmed updates

Default to server-confirmed: disable button → await response → update state → toast. Optimistic only when the operation is locally safe (e.g. status dropdown change has a rollback path).

### Motion

HQ uses motion sparingly: hover background transitions (~0.12s), the toggle slide (0.15s), the Radix accordion (0.2s), and `Loader2` spinners. These durations are ad hoc literals, not tokens; if motion grows, introduce `--motion-fast` / `--motion-base` tokens and a standard easing.

`prefers-reduced-motion: reduce` is respected app-wide via a global guard in `src/index.css` (collapses animation + transition durations). Any new animation inherits this automatically; do not add an animation that ignores it.

---

## 10. Component primitives in this repo

Worth knowing what's already built before reaching for shadcn/ui:

**Reusable across HQ:**
- `src/components/ui/*`: shadcn/ui primitives (Button, Card, Input, Select, Checkbox, RadioGroup, Slider, Textarea, Label, AlertDialog, sonner, toast, etc.)
- `src/components/AppShell.tsx`: top nav + main content wrapper for authenticated pages
- `src/components/ProtectedRoute.tsx` / `AdminRoute.tsx`: route gates
- `src/components/hq/DField.tsx`: HQ Core detail field wrapper.
- `src/components/hq/HQFormField.tsx`: HQ Core edit field wrapper.
- `src/components/hq/ContactsCard.tsx`: shared Contacts card for Venue, Vendor, and Client detail pages.
- `src/components/hq/WebsiteActionButton.tsx`: shared list-page Website action button.
- `src/components/data/ListPageChrome.tsx`: shared list search input and chip-radio group.
- `src/lib/url.ts`: neutral URL helpers, including `prettyHost`.

**Sanctioned HQ Core exceptions:**
- Venue Slide stays as a VenueDetail header action and VenueEdit "Master Venue Deck Slide" card. Do not move it into a generic Links card unless more Venue link types appear.
- Client, Person, and Vendor detail pages do not render raw `tags` arrays. Vendor Capabilities is the visible vendor tag-like surface.

**Venue-Scout-specific:**
- `src/components/venue-scout/matrix/primitives.tsx` — matrix shared module. Phase 5.12.14 swept the file (~830 → ~500 lines): deleted `VenueIdentityStack`, `WebsiteArrow`, `HdrStack`, all RANK scaffolding (`RankDisplay`, `rankBucket`, `RANK_TEXT`, `RANK_BAR`, `RankTier`), `EditableVenueName`, `NotesCellButton`, `EditableTextarea`, `StackDivider`; dropped `Pill` from exports (kept as internal helper for TypeTogglePopover); dropped 4 re-exports (`TYPE_STYLES`, `TYPE_FALLBACK_STYLE`, `parseTypes`, `CanonicalType`) — consumers import directly from `@/lib/venue-scout/venueTypes`. Surviving exports: `Th`, `Td`, `VStack`, `Bullets`, `EditableField`, `SourcePill` (4-state: Uploaded / Sourced / Manual / Venues DB; see § 5 above for tokens), `TypeTogglePopover` (horizontal variant enforces max-2-per-row via deterministic `grid grid-cols-2 gap-[6px] justify-items-start` when ≥2 pills). `DedupeMetaIndicator` + `normalizeDedupeMeta` + `DedupeMetaShape` stay exported as documented-dead future-state scaffolding (logged in code-observations; the `dedupe_meta` jsonb column on `vs_candidate_venues` is still written by `_shared/venueDedupe.ts`).
- `src/components/venue-scout/matrix/VenueMatrixRow.tsx` (Phase 5.12.14): shared row primitive that Sourcing + Shortlist both render through. Per-page differences collapse to the col-1 label (Shortlist vs Pitch) + col-1 handler + page-level source-of-truth (`shortlisted` vs `pitched`). 7-column layout: Shortlist/Pitch+Source (110px, stacked) | Venue (230px, name + horizontal type pills) | Location (180px, neighborhood + address) | Website (130px, InlineEditText with prettyHost tlink) | Features (230px, compact TagInput) | Recommendations (280px, Bullets) | Considerations (280px, Bullets). Total ~1440px.
- `src/components/venue-scout/ScoutPhaseBreadcrumb.tsx` (Phase 5.12.14): scout-level breadcrumb-stepper that replaced the prior `ScoutStepThroughNav` chip strip. 20px numbered circles + mono uppercase labels + `›` separators. Color states mirror `Stepper.tsx` (active = white-filled + coral label; reached = coral-filled with check + white label; unreached = grey + grey). Renders inline below the page crumb, above the eyebrow, on every scout action page with a defined `current_step`.
- `src/components/venue-scout/Stepper.tsx` (Phase 4 port; resized audit pass 2 item 5): brief-intake stepper. **24px** numbered circles + 13px mono uppercase labels + `w-10` connector hairlines. `active` prop accepts 1-3 for an active step and 4 for the all-done BriefReport state. Replaces the page-title eyebrow + `h-page` block on `BriefEvent` / `BriefVenue` / `BriefReport`; the stepper IS the page title now. **Canonical stepper sizes:** ScoutPhaseBreadcrumb = 20px circles; brief-intake Stepper = 24px circles. Talent Scout new-role wizard Stepper should adopt 24px when its sweep lands.
- `src/components/ReferrerCrumb.tsx` (Phase 5.12.14.1 Stage 2C — relocated from `/venue-scout/`): canonical app-wide back-crumb component. Renders `<IconArrowLeft className="ic ic-sm" /> Back to {label}` inside a `<Link className="crumb">`. Consumes `useReferrerCrumb` (`src/hooks/useReferrerCrumb.ts`) which resolves the crumb via three layers: (1) explicit `location.state.from` (list-page filtered-view "from" with `search` preserved — replaces the old `useBackHref` opt-in mechanism), (2) sessionStorage-tracked referrer with per-tab scope + loop protection, (3) caller-provided `fallback` prop OR canonical-parent fallback from the hook's route table. Use on every detail-page back-crumb. Optional `fallback={{ to, label }}` prop sets the layer-3 fallback. The old `src/lib/hq/useBackHref.ts` was deleted in 2C; `backState(location, label)` re-exports from `useReferrerCrumb.ts` for list-page navigators that explicitly push `state.from`.
- `src/components/venue-scout/SheetUploadCard.tsx` (Phase 5.12.14.1 Stage 2C item 4): drop-zone + parse-state + Continue action extracted from the deleted `SheetUpload.tsx` page. Mounts below the choice cards on the merged SheetPrompt surface when the producer picks "Yes, I have one". `vs-parse-sheet` edge-fn call + stale-parse race guard (parseGenRef) + error routing byte-identical to the pre-merge SheetUpload.
- `src/components/venue-scout/GeneratedDecksCard.tsx` + `src/components/venue-scout/BriefReportCard.tsx` (Phase 5.12.14): extracted from BriefReport.tsx as part of the god-file decomposition (closes the BriefReport.tsx slice of code-observations Frontend #19). GeneratedDecksCard is presentational; the parent owns the post-generate success toast (cluster 3 carry-in 2). BriefReportCard is the generic inline-editable card primitive (used 9 times on BriefReport).
- `src/components/ui/DateRangePicker.tsx` + `src/components/ui/calendar.tsx` (Phase 5.12.14, new dependencies `react-day-picker` + `date-fns`): range-mode date picker for Venue Scout brief intake + report pages. Stores formatted display strings ("Oct 15-17, 2026") into existing `text` columns; `parseOwnFormat` round-trips picker outputs (single / range-same-month / range-cross-month / range-cross-year). Future-lift opportunity to HQ surfaces (TaskEdit / ProjectEdit / DateCell / MirrorHolidaysEditor) tracked in code-observations.

**Talent-Scout-specific (some worth lifting to shared if Phase 4 / 5 want them):**
- `src/components/talent-scout/Stepper.tsx`: wizard stepper. Genericize for VS wizards.
- `src/components/talent-scout/TagInput.tsx`: tag/keyword input with case-insensitive dedup. Already used in Settings + RoleSettings + NewRoleSearch. **Already generic; no rename needed.**
- `src/components/talent-scout/CandidateTable.tsx`: the two-tier table pattern. Don't lift; copy + adapt for Venues / Projects since columns differ.
- `src/components/talent-scout/CriterionCard.tsx`: auto-grow textarea pattern. Useful reference for any inline-editable list-row.
- `src/pages/talent-scout/RoleSettings.tsx`: the canonical 2-column form page. **Read this first** when building Edit-Project, Edit-Venue, Edit-Client pages.

`src/components/ui/Field.tsx` is already extracted for Talent Scout / Venue Scout page forms. Do not use it for HQ Core edit pages, where grey labels come from `HQFormField`.

### Left rail brand + nav variants (Phase 5.12.12)

The left rail (`src/components/shell/LeftRail.tsx`) renders three context-aware shapes that share the underlying `.hq-rail` / `.hq-rail-grp` / `.hq-ri` chrome:

- **HQ context** (default; everywhere outside `/talent-scout/*` and `/venue-scout/*`): brand reads "Mirror HQ" inline via `.hq-brand` (56px row) + `.hq-brand-txt` + `.hq-brand-hq` (coral on "HQ"). Primary nav block is `PRIMARY_ITEMS` (11 entries). Second group is "Tools" (TOOLS_ITEMS; 6 entries) under the `.hq-rail-grp` heading.
- **TS context** (`/talent-scout/*`): same brand as HQ. Primary nav collapses to `TOOL_APP_PRIMARY` (HQ Home + Activity Feed). Second group is still "Tools" but the Settings entry's href routes through `resolveSettingsHref` from `src/lib/shell/` so it lands on `/talent-scout/settings`.
- **VS context** (`/venue-scout/*`): brand reads "Venue Scout" inline via the same `.hq-brand` + `.hq-brand-txt` chrome, with a new `.hq-brand-vs` accent class (coral on "Scout") that parallels `.hq-brand-hq`. Brand row stays at the canonical 56px. Brand link routes to `/venue-scout` (VS index). Primary nav is `TOOL_APP_PRIMARY`. The Tools group + label are hidden entirely; in their place the three VS_TOOL_ITEMS rows (Venue Scout parent + indented New Project + indented Settings; admin-only Settings filtered via the standard `adminOnly` flag) render directly under Activity Feed with no `.hq-rail-grp` separator heading. All three rows force coral active styling throughout VS via a new optional `forceActive` flag on `RailItem` so the rail keeps signaling "you are inside Venue Scout" regardless of which VS subpath the producer is on.

The indent treatment uses a new `.hq-ri--indent` modifier (padding-left 34px = 18px base + 16px indent). The active-state left-border-color on `.hq-ri--active` still renders flush to the rail's left edge regardless of left-padding, so indented children's active state looks identical to parent active state apart from the icon + label offset.

The `forceActive` mechanic composes with NavLink's `isActive`: RailLink's className callback does `isActive || item.forceActive ? "hq-ri--active" : ""`. The flag is set per-item at the group derivation site (not on the static VS_TOOL_ITEMS const), so a future tool app that wants "highlight only the exact current page" semantics can simply omit it.

Hover affordance on active rows comes from a companion `.hq-ri--active:hover` rule (white-tint background + coral text). Without it `.hq-ri--active`'s coral background fully overrides the default `.hq-ri:hover` styling (later rule + same specificity) and an active row's hover would look identical to its rest state. The rule applies to both HQ Tools' single-row active match and all three VS forceActive rows.

The `TopBar` (`src/components/shell/TopBar.tsx`) hides its global search bar inside `/venue-scout/*` because `/search` indexes HQ Core entities only (Projects / Venues / Vendors / People / Clients / Outlook). The cmd-k focus shortcut guards on the input being mounted before calling `preventDefault`, so it passes through to the browser shortcut on VS pages.

All chrome reuses existing tokens (`--primary` for coral, `--foreground` for white, `--surface` for the rail background, `--border` for the brand-block underline); no new design tokens introduced. Future tool apps follow one of the two patterns: keep the Tools group + add a prefix branch to `resolveSettingsHref`, OR replace the group + brand entirely (the VS pattern) by hardcoding a tool-items config + a brand variant with its own `.hq-brand-<tool>` accent class.

### Phase 5.12.14.3 (2026-05-27) tokens + patterns — VS UX Audit Pass 4

New tokens / primitives / patterns introduced across the 7-round phase. Cross-references to `decisions.md § Phase 5.12.14.3` and `v1-changelog.md` entry.

**Tokens / classes (`src/index.css`):**

- **`.hq-scout-label`** — TopBar center-zone label rendered inside any active VS scout route (`/venue-scout/scouts/:id/*`). Font: `var(--font-display)` (Montserrat) at 15px font-extrabold uppercase tracking-[-0.01em]. Color: `hsl(var(--foreground))`. Matches the `.hq-brand-txt` cadence as a peer of the left-zone wordmark. Defers visually to the brand (15px vs the brand's 21px). TopBar consumer: `src/components/shell/TopBar.tsx`; renders `Client Name · Event Name` with a `mx-2 opacity-50` mid-dot separator. Hidden below md.
- **`.scout-list-tbl`** — wrapper class consumed by ScoutIndex's `<DataTable>` (`src/pages/venue-scout/ScoutIndex.tsx`). Scopes a small set of overrides through to the inner `.tbl` to inherit the Sourcing/Shortlist matrix visual contract WITHOUT the matrix-specific deltas (no sticky col, no 1280 min-width, no `table-layout: fixed`). Overrides: header text-align center + bg `hsl(var(--surface))`, body td bg `hsl(var(--surface-alt))`, archived rows (selector hook `tr[style*="opacity"]`) match header bg + subtle-foreground text, per-cell border-right column dividers, drop the canon `::after` cell-divider pseudo bar.
- **`.tbl--matrix`** — VS matrix canon (Sourcing/Shortlist tables in `src/pages/venue-scout/SourcingReport.tsx` + `Shortlist.tsx`). Rule body: `width:100%; border-collapse:collapse; min-width:1280px; table-layout:fixed;`. **Standalone class — does NOT compose with `.tbl`** (see `decisions.md § Phase 5.12.14.3` decision 1 for the cascade rationale). Matrix Th/Td primitives in `src/components/venue-scout/matrix/primitives.tsx` drive the rest of the chrome via Tailwind utilities.

**Phase pill mapping** — design-system tokens applied to ScoutIndex's Phase column rendering. Module-level `SCOUT_PHASE_TOKENS: Record<string, StatusToken>` map in `src/pages/venue-scout/ScoutIndex.tsx`:

| Scout `current_step` | Token | Visual |
|---|---|---|
| `brief` / `sheet_prompt` / `sheet_upload` | `muted` | neutral grey |
| `researching` / `sourcing_report` | `info` | blue |
| `shortlist` | `purple` | purple |
| `review_selects` / `compiling` / `deck_prep` | `warn` | amber |
| `completed` | `success` | green |

Renders via `<span className="pill pill-sm p-{token}"><span className="dt" /> {label}</span>` — same chrome the old Status column used. Producer-revisable. Currently Status column is removed entirely; Phase is the sole producer-facing state surface on ScoutIndex.

**Layout primitives:**

- **`<ScoutPageHeader scoutId scout right?>`** (`src/components/venue-scout/ScoutPageHeader.tsx`) — 3-zone top row for every in-scout VS page. Layout: `[empty left] [ScoutPhaseBreadcrumb centered] [ScoutSettingsLink right (or override via `right` prop)]`. Empty left zone preserves the centered breadcrumb's visual balance regardless of right-zone width. Consumed by BriefEvent, BriefVenue, BriefReport, SourcingReport, Shortlist, Review, ScoutSettings, SheetPrompt (8 pages).
- **Counter row pattern** — `<div className="text-right text-base text-muted-foreground mb-3">` between the explainer card and the table/list on Review, Sourcing, Shortlist. Consistent across all three; produces the "X selected of N" / "X marked for deck" / "Venues Selected" affordance.

**Behavioral patterns:**

- **Back-crumb in TopBar (single source of truth).** Page-chrome `<ReferrerCrumb>` mounts retired across 21 pages/components. The TopBar (`src/components/shell/TopBar.tsx`) renders the global crumb via `useReferrerCrumb()` once per app shell. Predicate `showCrumb = referrerCrumb.href !== "/"` hides on root-tier pages (Home, list pages) where the crumb resolves to root and is meaningless. Hidden below md so mobile TopBar stays uncluttered. See `decisions.md § Phase 5.12.14.3` decision 2 for full rationale.
- **BriefReport stage-aware crumb override.** Hub page with multiple post-intake stages reachable; back-target depends on the scout's `current_step`. `useReferrerCrumb` extension fires a supabase fetch on pathname `/venue-scout/scouts/:id/brief/report`; routes to Brief Intake / Sourcing / Shortlist / Review per current_step. Hook-internal — every other page skips the fetch.
- **`.hq-explainer` flex-sibling layout.** Producer-call shift in R7 § C: explainer card flips from `<label> + <body>` stacked column to `display: flex; align-items: flex-start; gap: 12px;` with label as left sibling + prose as right sibling. Surrounding border + padding stays. Consumed by Review + Sourcing + Shortlist.

**Shared component lift (HQ + VS Settings):**

- **`<LookupListsCard lookups>`** (`src/components/settings/LookupListsCard.tsx`) — extracted from the inline `src/pages/settings/SettingsPage.tsx` Lookup Lists block during R7 amendment v1 § 6. Renders the `LIST | USED BY | VALUES | Edit` table with inline-expansion editor row. Caller-supplied `lookups: LookupListsCardEntry[]` filter. HQ Settings consumes the full 7-entry `HQ_LOOKUPS` (Project Categories / Cities / Neighborhoods / Venue Types / Vendor Capabilities / Vendor Categories / Departments); VS Settings consumes the 3-entry filter (Cities / Neighborhoods / Venue Types). Expansion-content branches on entry key: `neighborhoods` → `<NeighborhoodsLookupEditor inline />`; every other key → `<LookupListEditor table layout="tags">`. New `inline?: boolean` prop on `NeighborhoodsLookupEditor` drops the outer card chrome so it reads cleanly inside the expanded row.

---

## 11. The Talent Scout pages as design references

When designing a new HQ surface, find the closest analog in Talent Scout and start from its layout. Match the page widths, the card structure, the action-bar pattern. Then diverge intentionally where the new surface's needs differ.

| If you're building... | Start from |
| --- | --- |
| A list/table page (Projects, Venues, Clients, Tasks lists) | `RoleDashboard.tsx` and `CandidateTable.tsx` |
| A detail page with action header + content sections (Project Detail, Venue Detail) | `CandidateDetail.tsx` |
| An edit form (Edit Project, Edit Client) | `RoleSettings.tsx` |
| A multi-step wizard (Venue Scout brief / sourcing / deck) | `NewRoleDetails.tsx` → `NewRoleSearch.tsx` → `NewRoleScorecard.tsx` |
| A settings / global-config page (HQ Settings, User profile) | `Settings.tsx` (Talent Scout settings) |
| A loading-while-AI-runs page (Final review generation, Venue research) | `FinalReviewLoading.tsx` |
| A status-monitor surface (pull progress, scout progress) | `PullDetail.tsx` (PullStepsList live-updating via Realtime) |

### Wireframe-canonical class names (binding rule)

When a locked wireframe HTML exists for a sub-phase (`OUTPUTS/phase-X-*-wireframe-v*-LOCKED.html`), components MUST consume the wireframe's CSS class names byte-for-byte. Lift the wireframe's `<style>` block into `src/index.css` as a single "Phase X HQ Core surfaces" block; render JSX that mirrors the wireframe's DOM structure exactly.

Do NOT reinvent the wireframe's visual layer with parallel Tailwind utilities. Parallel Tailwind drifts. The 5.2.1 Revision rebuilt seven data components after the original 5.2.1 squash shipped them in parallel Tailwind that read "close but off" against the wireframe (view switchers as pills instead of icon-segmented buttons, filter chips missing `.fchip` shape, tables missing `.tbl` header styling). Cost: a full revision round.

If the wireframe uses a class that Tailwind would purge as dynamic (`pill p-${token}`, `cal-ev ${kind}`, `rb-${token}`), add the variants to `tailwind.config.{ts,js}` `safelist` so the production build keeps them. Tailwind purge cannot detect template-literal class names statically.

Wireframe-canonical class names + the per-surface wireframe binding (per `docs/working-with-claude.md` § 4.4) are the two contracts that prevent visual fidelity drift.

---

## 12. Brand rules that bit us (don't forget these)

Compiled from the visual audit + Phase 3.7 / 3.10 sessions. Keep these top-of-mind on any new surface:

1. **Slider track + score bar track use `bg-input`** (not `bg-secondary`) on Mirror grey card surfaces. Two phases lost catching this.
2. **Hooks above any early return.** React strict-mode rule. Multiple "Rendered more hooks than during the previous render" black-screens in 3.5 / 3.7. Subagents miss this; code-reviewer subagent in `working-with-claude.md` calls it out explicitly.
3. **JSX names imported.** A component used but not imported passes `tsc --noEmit` AND `vite build` AND only crashes at runtime. Eyeball every import after rename refactors.
4. **mailto:** use `inline-block max-w-full truncate align-bottom`, not `block truncate` (which makes the entire column clickable).
5. **Em dashes don't render in Gmail subject lines.** Phase 3.11.1's pull-completion email subject came back garbled. Use `|` for separators in any email subject. Match Jimmie's "no em dashes anywhere" rule everywhere.
6. **Local dev runs at `http://127.0.0.1:8080/`**, not `localhost:8080`. Vite binds IPv6.
7. **`mirrornyc.com` is in `BLOCKED_PORTFOLIO_DOMAINS`** in `_shared/unwrapUrl.ts`. Don't remove it: manager email signatures embed the URL.
8. **ReferralPill stays electric blue.** Coral was tried (3.7.8.8) and reverted (3.7.8.13) because too many coral surfaces blurred the signal.

---

## 13. When this doc needs an update

- New token introduced (rare, should require justification)
- New page-level pattern emerges that's reused twice (extract here)
- A brand rule we hit twice gets a section here so we stop hitting it
- Any deviation from the patterns above on a new surface: document it in `docs/decisions.md` AND add the new pattern here

This doc is the source of truth for "how an HQ surface looks and behaves." Code drift from this doc is a bug to file, not a precedent to follow.
