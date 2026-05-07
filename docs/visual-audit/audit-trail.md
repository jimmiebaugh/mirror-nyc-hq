# Audit trail: every change made in Phase 3.5b

Granular log of every file touched in the visual brand pass. Use this to walk through HQ in your browser and verify each fix landed correctly. Pair with `mirror-style-guide.md` (the spec this implements), `hq-vs-source-diff.md` (where HQ drifted), `token-diff.md` (token-level history), and `screenshot-decision.md` (why no live screenshots).

## Pass 2 (post-deck-template review): Mirror-canonical brand applied

After Jimmie reviewed the first pass and supplied the brand-authoritative deck template (`BLANK DECK TEMPLATE (2026).pptx`), the entire token + font foundation was re-aligned to deck values. Locked answers from `mirror-style-guide.md` § 5:

- Coral hex: `#BE4E44` (deck-canonical, NOT source's `#ef5b5b`)
- Display font: **Montserrat ExtraBold** (+ Montserrat regular)
- Caption / label font: **Roboto Mono**
- Body font: **Roboto** (proportional, replaces Inter)
- Page titles: ALL CAPS in Montserrat ExtraBold
- Button labels: stay sentence/title case (uppercase reads too presentational)
- Side rail pattern: not on Talent Scout for now (revisit for HQ Core)
- Coral frequency: keep current usage on CTAs / eyebrows / R-pills

### `src/index.css` — wholesale Pass-2 rewrite
- Google Fonts import flipped from Inter to Montserrat (400, 800) + Roboto (300, 400, 500) + Roboto Mono (300, 400, 500, 700).
- `--primary` flipped from `0 83% 65%` (#ef5b5b) → `4 47% 51%` (#BE4E44 dusty coral).
- `--primary-hover` from `0 86% 71%` (#f47373) → `4 53% 56%` (#CC5C52, +5% lightness).
- `--ring` mirrors new `--primary`.
- New CSS vars: `--font-display` (Montserrat), `--font-body` (Roboto), `--font-mono` (Roboto Mono).
- Body font-family swapped to `var(--font-body)` (Roboto) at 15px.
- `--surface` lifted from `0 0% 8%` to `0 0% 4%` (#0A0A0A — barely off black, deck-aligned).
- `--surface-alt` from `0 0% 11%` to `0 0% 8%` (#141414).
- `--surface-raised` from `0 0% 14%` to `0 0% 12%` (#1F1F1F).
- `--popover` updated to surface-raised (12% — was 8%).
- Sidebar tokens updated to match new dark palette.
- Component utilities (`.h-page`, `.label-section`, `.crumb`, `.btn-base`, etc.) refactored to reference `var(--font-display)` / `var(--font-mono)` / `var(--font-body)`. New `.h-section` and `.eyebrow` utilities.
- `.btn-base` casing left case-as-typed (no auto-uppercase) per Q6 review.
- `.tier-badge--bonus` and `.manual-tag` background rgba updated to `190, 78, 68` (#BE4E44 components).

### `tailwind.config.ts`
- `fontFamily.sans` from `["Inter", ...]` to `["Roboto", ...]` so default `font-sans` resolves to Roboto.
- Added `fontFamily.display: ["Montserrat", ...]`.
- Added `fontFamily.mono: ["Roboto Mono", ...]`.

### Page titles → `.h-page` utility (10 files)
Every `<h1 className="text-3xl font-semibold tracking-tight">` swapped to `<h1 className="h-page">` so titles render in Montserrat ExtraBold uppercase 32px:
- `src/pages/talent-scout/Index.tsx` ("Open roles")
- `src/pages/talent-scout/RoleDashboard.tsx` (role title)
- `src/pages/talent-scout/PullDetail.tsx` (role title)
- `src/pages/talent-scout/CandidateDetail.tsx` (candidate name)
- `src/pages/talent-scout/NewRoleDetails.tsx` ("Role details")
- `src/pages/talent-scout/NewRoleSearch.tsx` ("Email search")
- `src/pages/talent-scout/NewRoleScorecard.tsx` ("Review scorecard")
- `src/pages/talent-scout/RoleSettings.tsx` ("Edit role")
- `src/pages/Dashboard.tsx`
- `src/pages/Projects.tsx` ("All projects")

### Caption / label patterns → `font-mono`
Bulk-added `font-mono` to two label patterns across `src/pages/talent-scout/` and `src/components/talent-scout/`:
- `font-bold uppercase tracking-wider` → `font-mono font-bold uppercase tracking-wider` (every label, pill text, table header, stat tile label, badge text)
- `uppercase tracking-widest` → `font-mono uppercase tracking-widest` (eyebrow captions like "Talent Scout · New Role")

50+ inline class strings updated; all label-style usage now renders in Roboto Mono. Body text and table cells (which don't carry these tokens) stay on Roboto.

### Stat tile numbers → Montserrat ExtraBold
`text-3xl font-black` and `text-4xl font-black` patterns swapped to `font-display text-(3xl|4xl) font-extrabold` in:
- `src/pages/talent-scout/CandidateDetail.tsx` (the giant 72/105 score readout, total score)
- `src/pages/talent-scout/RoleDashboard.tsx` (R{n} round numbers, stat tile values)
- `src/pages/talent-scout/PullDetail.tsx` (stat tile values)

These big tabular numbers now hit Montserrat ExtraBold to match the deck's display weight.

### `src/components/talent-scout/Stepper.tsx`
- Step label className: `text-xs font-semibold uppercase tracking-wider` → `font-mono text-xs font-bold uppercase tracking-wider`. The "1 ROLE DETAILS / 2 SEARCH SETUP / 3 SCORECARD" stepper now reads in Roboto Mono.

### `src/components/AppShell.tsx`
- Brand wordmark "Mirror NYC HQ": `text-sm font-semibold tracking-tight` → `font-display text-[15px] font-extrabold uppercase tracking-tight`. The brand mark now reads as a Montserrat ExtraBold caps wordmark, with the "HQ" suffix in coral.
- Nav links: `rounded-md px-3 py-1.5 text-sm` → `rounded-sm px-3 py-1.5 font-mono text-[11px] font-bold uppercase tracking-[0.08em]`. Top nav now reads as deck-style mono caps captions.

### `src/pages/Landing.tsx`
- Hidden "STRATEGY / DESIGN / PRODUCTION" sign-in trigger: added `font-mono` so it matches the deck cover slide's footer treatment exactly (where it appears in Roboto Mono on pure black).

### Pass-1 survivors (kept as-is)
Pass-1 changes still in effect after Pass-2 layered on top:
- StatusDropdown: cyan/purple/amber/red text colors at 500-shade. Still correct — these aren't deck colors but match source's StatusDropdown pattern, and the deck doesn't dictate dropdown affordances.
- CandidateTable bulk action buttons: 500-shade text colors. Same reasoning.
- Tier T3 + Final Report + Latest + Scheduled: `green-400` (#4ADE80) instead of emerald. Matches source AND maps to the success token.
- Tier T1 + Closed + Failed: red-500. Tier T2 + Stalled + Running: amber-500. Bonus tier: coral primary (now #BE4E44 via the new token).

## Pass 1 (initial Phase 3.5b — pre-deck-review)

The original "match HQ to source" pass. Most of these changes still stand; the coral hex and font choices were superseded by Pass 2 above. Kept here for history.



## A. Token files (the wholesale brand swap)

### `src/index.css`

Wholesale rewrite. Replaced HQ's emerald-on-blue-dark palette with source's coral-on-pure-black palette. Changes:

- Added `@import` for Inter weights 400-900 from Google Fonts.
- Replaced `:root` and `.dark` blocks. Both now resolve to the same source tokens (HQ runs dark-only via the hardcoded `dark` class on `<html>`).
- Body font-family swapped to `'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif` with explicit `font-size: 17px` and `line-height: 1.5`. Removed `font-feature-settings: "ss01", "cv11"` (source doesn't use them).
- Added `--surface`, `--surface-alt`, `--surface-raised`, `--primary-hover`, `--subtle-foreground`, `--success`, `--warn`, `--border-strong` tokens.
- Changed `--radius` from `0.5rem` to `0.25rem` (source's squarer 4px corners).
- `--primary` flipped from emerald `158 64% 52%` to coral `0 83% 65%` (`#ef5b5b`).
- `--accent` changed from being a duplicate of primary (emerald) to a surface color `0 0% 14%` — source's semantic of "accent = elevated surface", not a brand color highlight.
- Sidebar tokens preserved (the unused shadcn `<Sidebar />` primitive references them); aligned values to the new dark palette.
- Added `@layer components` with source's full set of brand utilities: `.h-page`, `.label-section`, `.label-form`, `.crumb`, `.btn-base`/`.btn-primary`/`.btn-ghost`/`.btn-light`, `.input-base`/`.input-filled`/`.textarea-base`, `.tier-badge` + variants, `.manual-tag`, `.surface`/`.surface-alt`, `.status-pill` + variants. None used in HQ today; defining them keeps source-equivalent components pixel-aligned if/when ported.

**What you'll see**: every page now reads on pure-black with coral accents instead of blue-tinted dark with green accents. Inter font is loaded and applied site-wide.

### `tailwind.config.ts`

- Added `fontFamily.sans = ["Inter", "ui-sans-serif", "system-ui"]` so default `font-sans` utility prefers Inter.
- Added Tailwind utilities for new tokens: `border-strong`, `surface`/`-alt`/`-raised`, `primary.hover`, `subtle.foreground`, `success`, `warn`.

## B. Component-level color fixes

For each component that hardcoded the old brand greens (emerald) or used 400-shade text on translucent badge backgrounds, swapped to source-canonical colors.

### `src/components/talent-scout/RoleStatusPill.tsx`
- "Final Report" pill: `bg-emerald-500/10 text-emerald-400 border-emerald-500/30` → `bg-green-400/10 text-green-400 border-green-400/30`. Now hits source's `#4ade80` exactly (matches source's `tier-badge--3` and `status-pill--complete` color).
- "Closed" pill text: `text-red-400` → `text-red-500` to match source's hex `#ef4444`.

### `src/components/talent-scout/RoundStatusPill.tsx`
- Running pill: `text-amber-400` → `text-amber-500` (source uses `#f59e0b` = amber-500).
- Failed/Stalled pill: `text-red-400` → `text-red-500` (source uses `#ef4444` = red-500).

### `src/components/talent-scout/StatusDropdown.tsx`
Aligned the four user-selectable statuses to source's exact hex values. Backgrounds and borders already used 500-shade with opacity (correct); only text was off by one shade.
- `interview`: `text-cyan-400` → `text-cyan-500` (`#06b6d4`)
- `fast_track`: `text-purple-400` → `text-purple-500` (`#a855f7`)
- `consider`: `text-amber-400` → `text-amber-500` (`#f59e0b`)
- `reject`: `text-red-400` → `text-red-500` (`#ef4444`)
- `auto_rejected`: unchanged. AI-only / disabled, the muted `text-red-400/80` is correct visual semantics for a non-actionable state.

### `src/components/talent-scout/CandidateTable.tsx`
Bulk action button text colors aligned to match StatusDropdown:
- Reject: `text-red-400` → `text-red-500`
- Consider: `text-amber-400` → `text-amber-500`
- Fast-Track: `text-purple-400` → `text-purple-500`
- Interview: `text-cyan-400` → `text-cyan-500`

### `src/pages/talent-scout/CandidateDetail.tsx`
`TIER_META` (scorecard tier display):
- T1: `text-red-400` → `text-red-500`
- T2: `text-amber-400` → `text-amber-500`
- T3: `bg-emerald-500/10 border-emerald-500/30 text-emerald-400` → `bg-green-400/10 border-green-400/30 text-green-400` (matches source `#4ade80`)

### `src/pages/talent-scout/NewRoleScorecard.tsx`
- Same `TIER_META` swap as CandidateDetail (T1 red-500, T2 amber-500, T3 green-400).
- "Bonus — Competitor Experience" pill: was `border-purple-500/30 bg-purple-500/10 text-purple-400`. Now `border-primary/40 bg-primary/15 text-primary` — coral primary, matching source's `tier-badge--bonus`.

### `src/pages/talent-scout/RoleDashboard.tsx`
- "Scheduled" badge: `border-emerald-500/30 bg-emerald-500/10 text-emerald-400` → `border-green-400/30 bg-green-400/10 text-green-400`.
- Failed inline pill: `text-red-400` → `text-red-500`.
- Stalled inline pill: `text-amber-400` → `text-amber-500`.

### `src/pages/talent-scout/PullDetail.tsx`
- "Latest" badge on round headers: `border-emerald-500/40 bg-emerald-500/10 text-emerald-400` → `border-green-400/40 bg-green-400/10 text-green-400`.

## What I deliberately did NOT touch

These showed up in the grep but weren't drift; they're intentional:

- `src/lib/talent-scout/scoreColor.ts` already matches source's score-color thresholds exactly (`#4ade80`, `#22c55e`, `#facc15`, `#eab308`, `#f59e0b`, `#ef4444`, `#991b1b`). Verified line-by-line vs source's `src/lib/scoreColor.ts`.
- `src/pages/talent-scout/Index.tsx`: `text-amber-400` for the "OPEN" stat-tile count and `text-red-400` for the close-role action text. Source's Index uses similar 400-shade text for delete actions (`text-red-400 hover:text-red-300`); these match.
- `src/pages/talent-scout/PullDetail.tsx` and `Index.tsx`: `bg-red-500 text-white hover:bg-red-600` on destructive AlertDialog actions. Source uses identical classes.
- `src/pages/talent-scout/RoleDashboard.tsx` and `PullDetail.tsx`: `text-amber-400` on stat-tile values when `accent` flag is set. Numeric accent, not a status pill. Source uses comparable accent shading on numeric tiles.
- `src/pages/Index.tsx` line 8 (`#fcfbf8` cream background): this is the unused `Index` page (HQ uses `Dashboard` for `/`). Stale code from the Lovable scaffold. Out of scope; flagged in `structural-drift.md`.
- `src/components/ui/*`: shadcn primitives. Off-limits; they consume tokens via Tailwind classes and update automatically.

## Quick local-review checklist

Walk these pages on `localhost:8080` after `git checkout phase-3-5b-visual-brand && npm run dev`. Each takes ~30 seconds to eyeball:

1. **Coming Soon** (`/`, signed out) — Mirror logo + STRATEGY/DESIGN/PRODUCTION line. Should look the same; the new tokens shouldn't have shifted anything since it's pure black + white.
2. **Dashboard** (`/`, signed in) — header logo "HQ" suffix should be coral now, not green.
3. **Talent Scout Index** (`/talent-scout`) — role rows; the open-role count text amber stays, all fonts should now be Inter.
4. **Role Dashboard** — RoleStatusPill ("R3", "Final Report" if any, "Closed"); pull-round cards with "Latest" / "Failed" / "Stalled" badges; stat tiles; "Scheduled: Daily" badge if a role has it on.
5. **Pull Round Dashboard** — same round cards, "Latest" badge on the most recent round.
6. **Candidate Detail** — score pill (still uses scoreColor.ts thresholds, unchanged), tier badges in scorecard breakdown (T1 red, T2 amber, T3 green-400).
7. **New Role wizard, step 3 (scorecard)** — three tier sections + bonus row (now coral, was purple).
8. **Role Settings** — same tier display as scorecard step.

Things to specifically look for:
- Coral `#ef5b5b` everywhere "primary" appears (buttons, links, focus rings, "R3" pills).
- T3 tier and "Final Report" / "Latest" pills should be a slightly lighter green than before — the new `#4ade80` is the source's success hue, where before HQ was on `#10b981` (deeper teal-green).
- StatusDropdown pill text should look slightly more saturated than before (500-shade vs 400-shade).
- All text should render in Inter. If you see any system-font fallback (looks more "macOS native"), let me know — means the font import didn't reach that view.
