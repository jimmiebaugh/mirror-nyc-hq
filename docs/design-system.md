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

**Gotcha:** slider track + score-bar track must be `bg-input` (not `bg-secondary`). On `bg-surface-alt` cards both share `#141414`, making `bg-secondary` invisible. Phase 3.5/3.7 cost us multiple sessions catching this. See `src/components/ui/slider.tsx` and `src/components/talent-scout/ScoreInline.tsx`.

### Type

Three families:
- **Montserrat ExtraBold** (`var(--font-display)`): page titles, eyebrows, brand wordmark, criterion names
- **Roboto Mono** (`var(--font-mono)`): labels, captions, status pills, breadcrumb, "TIER 1: MUST-HAVES"
- **Roboto** (`var(--font-body)`): body text, form inputs, narrative content

Sizes (utility classes in `src/index.css`):
- `.h-page`: page title (`text-[34px] font-display font-extrabold uppercase`)
- `.h-section`: section header inside a card (`text-[20px] font-display`)
- `.label-section`: section eyebrow (`text-[12px] font-mono uppercase tracking-wider`)
- `.label-form`: form-field label (`text-[12px] font-mono font-bold uppercase tracking-wider`)
- `.eyebrow`: coral eyebrow above a title (`text-[14px] font-mono uppercase tracking-widest text-primary`)
- `.crumb`: back-link breadcrumb (`text-[14px] font-mono uppercase tracking-widest text-primary hover:underline`)

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

Standard pattern:

```jsx
<header className="space-y-2">
  <Link to={backTo} className="crumb">
    ← Back to {parent}
  </Link>
  <h1 className="h-page">{Title}</h1>
  <p className="text-sm text-muted-foreground">{One-line description}</p>
</header>
```

Reference: `src/pages/talent-scout/Settings.tsx`, `RoleSettings.tsx`.

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

### Field component (worth extracting)

Extracted to `src/components/ui/Field.tsx` in Phase 4 (port). Use the shared component for any new form.

```jsx
function Field({ label, required, children }: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label className="text-[12px] font-mono font-bold uppercase tracking-wider text-primary">
        {label}
        {required && <span className="ml-1 text-primary">*</span>}
      </Label>
      {children}
    </div>
  );
}
```

Required marker is a coral asterisk. Always.

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

---

## 4. Tables (CandidateTable is the canonical pattern)

Two-tier pattern: active rows above, rejected rows below collapsible. With status-priority sort and inline status dropdown per row.

Reference: `src/components/talent-scout/CandidateTable.tsx`. **Read this file before building any tabular surface in Phase 4 / 5.** Project lists, venue lists, task lists all map to this pattern with column shape adjusted.

Talent Scout's CandidateTable carries its own select-row + bulk action bar (used for the round-level Re-evaluate / Reject / Promote flow). HQ Core's shared `<DataTable>` does NOT carry row selection — when extending DataTable, don't pattern-match from CandidateTable's bulk action bar.

Column header rules:
- 12px mono uppercase
- Left-aligned for text, right-aligned for numbers, center for status
- Header has a separate row with `bg-surface-alt` border bottom

Row rules:
- Hover: `bg-muted/40`
- Status-color left border (3px solid) per row to surface status at a glance
- Click a row → navigate to detail

---

## 5. Pills + badges

Status pills are everywhere in HQ. Three sizes:

| Size | Class fragment | Use |
| --- | --- | --- |
| Compact | `h-7 text-[10px] px-2` | Inline next to a name, tight surfaces |
| Default | `h-8 text-[12px] px-2.5` | Status dropdown, pill rows |
| Large | `h-10 text-[16px] px-4 py-2` | Hero pill on detail-page header |

References: `RoundStatusPill.tsx`, `RoleStatusPill.tsx`, `ReferralPill.tsx`, `ReviewedPill.tsx`, `StatusDropdown.tsx`.

**Color rules:**
- Status (running/complete/failed/etc.) → tier-derived color from `mirror-style-guide.md`
- Auto/manual reviewed → muted grey vs solid coral
- Latest / Most-recent indicator → green (success token)
- Reject / DQ → destructive red
- Referral pill → electric blue (NOT coral). Coral was tried in 3.7.8.8, reverted in 3.7.8.13 because too many other coral surfaces blurred the signal.

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

Coral (`--primary`) is reserved as an accent (primary CTAs, eyebrows, focus rings, primary record links). It is NEVER a status color.

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

Implementation pointer: `src/lib/home/projectStatusToken.ts` is the canonical mapper for the Project + Task enums; `.hq-pill--<token>` classes in `src/index.css` render the resolved color.

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

---

## 10. Component primitives in this repo

Worth knowing what's already built before reaching for shadcn/ui:

**Reusable across HQ:**
- `src/components/ui/*`: shadcn/ui primitives (Button, Card, Input, Select, Checkbox, RadioGroup, Slider, Textarea, Label, AlertDialog, sonner, toast, etc.)
- `src/components/AppShell.tsx`: top nav + main content wrapper for authenticated pages
- `src/components/ProtectedRoute.tsx` / `AdminRoute.tsx`: route gates

**Talent-Scout-specific (some worth lifting to shared if Phase 4 / 5 want them):**
- `src/components/talent-scout/Stepper.tsx`: wizard stepper. Genericize for VS wizards.
- `src/components/talent-scout/TagInput.tsx`: tag/keyword input with case-insensitive dedup. Already used in Settings + RoleSettings + NewRoleSearch. **Already generic; no rename needed.**
- `src/components/talent-scout/CandidateTable.tsx`: the two-tier table pattern. Don't lift; copy + adapt for Venues / Projects since columns differ.
- `src/components/talent-scout/CriterionCard.tsx`: auto-grow textarea pattern. Useful reference for any inline-editable list-row.
- `src/pages/talent-scout/RoleSettings.tsx`: the canonical 2-column form page. **Read this first** when building Edit-Project, Edit-Venue, Edit-Client pages.

**To extract in Phase 4:** the `Field` helper component currently duplicated in `NewRoleDetails.tsx` and `RoleSettings.tsx`. Move to `src/components/ui/Field.tsx`.

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
