# HQ vs Source: visual diff

Side-by-side observations from the Talent Scout screenshot comparison PDF (Desktop / Screenshot comparisons.pdf). Read against the brand authority: the Mirror NYC blank deck template (`BLANK DECK TEMPLATE (2026).pptx`): to flag where each app drifts from the canonical brand.

The HQ build referenced here is `main` pre-Phase-3.5b. Phase 3.5b's coral-on-pure-black token swap is not yet visible in these screenshots (those changes target a coral that turns out to be the wrong coral; see § Coral hex below).

## At-a-glance

| Surface | HQ (current) | Source | Deck template (authority) |
| --- | --- | --- | --- |
| Page background | Pure black `#000` | Pure black `#000` | Pure black `#000` for covers/dividers; off-white for content |
| Primary accent | Coral `#ef5b5b` (3.5b target) | Coral `#ef5b5b` | **Dusty coral `#BE4E44`** |
| Display font | Inter (variable) | Inter Black uppercase | **Montserrat ExtraBold** uppercase |
| Body font | Inter | Inter | **Roboto** (proportional) |
| Caption / label font | Inter, bold uppercase, tracked | Inter, bold uppercase, tracked | **Roboto Mono** + **Roboto Mono Light** |
| Page title casing | Sentence case ("Open roles") | All caps ("OPEN ROLES") | All caps ("CLIENT NAME", "EVENT OVERVIEW") |
| Button casing | Sentence case ("New Role") | All caps ("+ NEW ROLE") | (no buttons in deck: but section labels and CTAs all-caps) |
| Button radius | Visible 6-8px (shadcn default) | 4px | (n/a; layout boxes generally squared) |
| Density | **Compact**: tight stat tiles, smaller type, less padding | **Loose**: large display headers, big stat tiles, more breathing room | Loose, but it's a presentation deck not a dashboard |
| Header chrome | "Mirror NYC HQ" wordmark + nav links + email + avatar | "M" mark + "TALENT SCOUT" mono caption, then nav | (n/a) |

HQ's compactness is intentional and correct for a dashboard. The brand drift is in **what's IN the cells**, not how dense the layout is.

## Surface-by-surface diff

### Dashboard / Talent Scout index

**HQ:** Title "Open roles" sentence case in proportional sans, ~28px. "ACTIVE HIRING SEARCHES" subtitle. Compact role-row table with normal-weight headers. "+ New Role" button in coral with sentence case, slight rounded corners.

**Source:** "OPEN ROLES" all caps, very heavy ExtraBold weight, much larger (~50px). Subtitle in lighter caption. Same row table but with caps headers ("ROLE / HIRING MANAGER", "ROLE POSTED", "LAST PULL", "STATUS", "REVIEWED", "IN POOL"). "+ NEW ROLE" all caps, sharper corners.

**Deck template authority:** "CLIENT NAME" / "PROJECT NAME" set in Montserrat ExtraBold + Montserrat at 36pt, all caps. "DATE | LOCATION" in Roboto Mono coral 16pt under it. The title slide's hierarchy maps to a dashboard's page title + caption pattern.

**Verdict:** HQ's title typography and casing drifts. Source is closer to brand but uses Inter, not Montserrat, so even Source isn't fully on-brand. The fix isn't "match Source": it's "go straight to Montserrat ExtraBold for display + Roboto Mono for the eyebrow caption."

### Role dashboard (Test Events Producer / Senior Graphic Designer)

**HQ:** Compact card. Big role title in proportional sans. Stat tiles (TOTAL REVIEWED / IN POOL / FAST-TRACKED / REJECTED) labels uppercase tracked, numbers tabular bold. R1 pill in coral, "SCHEDULE OFF" pill in muted gray, "Pull New Candidates" coral button.

**Source:** Same structure but at much larger scale. "SENIOR GRAPHIC DESIGNER" headline reads ~2x the size of HQ's. Stat tiles wider, numbers bigger. Same pill conventions. Buttons all caps.

**Deck template authority:** No direct equivalent (it's a deck, not a dashboard). But the section-divider pattern is instructive: huge ExtraBold name in white, paired with a coral numeral. The visual pairing of "big white name + coral marker" is exactly what HQ's "TEST EVENTS PRODUCER + R1 pill" does: just needs the right typeface and the right coral.

**Verdict:** HQ's compact stat tiles are a strength to KEEP. The drift is typography (use Montserrat ExtraBold for the role title) and label font (use Roboto Mono for stat labels and pill text: those uppercase tracked captions are exactly what mono is designed for).

### Pull round dashboard

**HQ:** "Test Events Producer" title with R1, RUNNING, LATEST pills. Compact processing strip with progress bar.

**Source:** Same hierarchy, larger display, mono caption above the title ("PULL ROUND / ← BACK TO SENIOR GRAPHIC DESIGNER"). Sub-page mono breadcrumb is a brand pattern HQ doesn't use yet but could.

**Verdict:** Source's mono breadcrumb ("PULL ROUND") is the deck template's side-rail mono caption pattern adapted for navigation. HQ would benefit from this: the deck template strongly signals that mono small-caps belongs on every secondary navigation cue.

### Candidate detail (Joe Famularo / Nick Dipillo)

**HQ:** Compact two-column layout. "Joe Famularo" mixed case in proportional sans. Coral "RECRUITER OVERVIEW" / "FILES & MATERIALS" / "TOP STRENGTHS" / "KEY GAPS" section labels (uppercase tracked). Score breakdown tier badges colored (T1 red, T2 amber, T3 emerald: emerald wrong per brand).

**Source:** "NICK DIPILLO" all caps very heavy. Same section structure but with bigger panels, more padding. Section labels in coral uppercase tracked. Tier badges same color pattern but with the source-canonical green for T3.

**Deck template authority:** Content slides (e.g. EVENT OVERVIEW, slide 4) use:
- Section header in **Montserrat ExtraBold** uppercase
- Field labels ("Date:", "Time:", "Guest Count:") in **Roboto Mono bold**
- Values in **Roboto Mono Light**

This is an EXACT analogue to candidate detail's "RECRUITER OVERVIEW" header + body content. The deck wants those section labels in Roboto Mono and the candidate name in Montserrat ExtraBold.

**Verdict:** Strongest brand opportunity in HQ. Replace candidate name with Montserrat ExtraBold all-caps; replace section headers with Roboto Mono coral; keep HQ's compact panel layout (it's better than source's loose padding for a dense data view).

### New Role wizard

**HQ:** Stepper (1 ROLE DETAILS / 2 SEARCH SETUP / 3 SCORECARD) tracked uppercase mono. "Role details" sentence case page title. Form labels coral uppercase tracked. Coral primary button "Continue".

**Source:** Same stepper visual. "NEW ROLE" all caps massive ExtraBold display. Form labels coral mono caps. "CONTINUE →" all caps button. "EMAIL SEARCH", "GENERATING SCORECARD..." all caps everywhere.

**Verdict:** Source's caps + ExtraBold is correct brand-direction. The form-label color (coral, uppercase tracked) is correct in both: just needs to be Roboto Mono. HQ's stepper is already very close; just font swap.

### Scorecard review

**HQ:** "Review scorecard" sentence-case title. "TIER 1: MUST-HAVES" / "TIER 2: STRONG DIFFERENTIATORS" / "TIER 3: NICE-TO-HAVES" colored badges. Bonus pill purple (Phase 3.5b changes this to coral primary). Approve & lock button coral.

**Source:** "REVIEW SCORECARD" all caps. Same badge structure with stronger visual weight. Bonus pill is coral (matches deck's brand restraint: coral is the Mirror accent, not the "secondary purple" some other apps use for bonuses). "RESET TO MIRROR DEFAULT" button in mono lowercase italic: interesting brand cue.

**Verdict:** Phase 3.5b's coral-bonus-pill change is on-brand per source AND deck. Stays correct. Tier badge colors (red / amber / green) are NOT in the deck explicitly but the deck's restrained palette suggests these should stay tonal/muted, not blaring saturated.

### Settings

**HQ:** Doesn't exist yet (Phase 3.7 territory).

**Source:** "SETTINGS" giant ExtraBold caps title. Field labels mono caps. Connected pill green-on-mono. "DISCONNECT GMAIL" all caps button. Spend cap inline with note. Global competitor list textarea.

**Verdict:** When HQ builds settings (Phase 3.7), match this structure with the new typography. Source's information architecture is right.

## Where HQ's compactness is correct and should stay

The user is explicit: keep HQ's compactness. These items DON'T change:

1. **Stat tile size and spacing.** HQ's tiles are dense and readable. Source's are decorative. Stay HQ.
2. **Header bar height.** HQ's `h-14` thin header is correct for a dashboard. Source's header is taller and decorative.
3. **Table row density.** Compact rows, single-line summaries. Stay HQ.
4. **Padding inside cards.** HQ's tighter padding works for data. Stay HQ.
5. **Two-column candidate detail.** HQ's grid use of horizontal space is more efficient than source's stacked panels.

## Where HQ drifts from brand and SHOULD change

Specific drifts that the proposed style guide will fix:

1. **Coral hex.** `#ef5b5b` (current Phase-3.5b target) → `#BE4E44` (deck-canonical). The brighter coral feels more "tech red" while the duskier `#BE4E44` is the actual Mirror coral on every client deliverable.
2. **Display font.** Inter → **Montserrat ExtraBold + Montserrat**. Page titles, role names, candidate names, settings titles: all set in Montserrat caps.
3. **Caption/label font.** Inter → **Roboto Mono**. Every uppercase-tracked label, every pill, every stepper number, every "TALENT SCOUT" eyebrow caption.
4. **Body font.** Inter → **Roboto** (proportional). For paragraph content like recruiter overview, score-breakdown row labels.
5. **Title casing.** Sentence case → ALL CAPS for page titles, role names, candidate names, section dividers.
6. **Button casing.** Sentence case → ALL CAPS. Buttons read as architectural elements, not friendly prompts.
7. **Border radius.** 6-8px (shadcn default `rounded-md`) → **4px** (`rounded-sm`). The deck template fully avoids rounded shapes; squarer corners feel more on-brand.
8. **Tier 3 / "Final Report" / "Latest" green.** The Phase 3.5b switch from emerald (`#10b981`) → green-400 (`#4ade80`) was correct vs source. The deck doesn't use a positive-status green explicitly, but `#4ade80` is the closer match to source. Keep.

## What stays the same as Phase 3.5b's plan

- Pure black background
- StatusDropdown text colors aligned to 500-shade
- Bonus pill in coral primary
- Inter font import REMOVED in favor of Montserrat + Roboto Mono + Roboto
- emerald → green-400 swap for Tier 3 / Latest / Final Report

## What CHANGES from Phase 3.5b's plan

- Coral hex: `#ef5b5b` → `#BE4E44`. Every coral token, every coral class. This is the single biggest revision.
- Font stack: Inter → Montserrat / Roboto / Roboto Mono. Different Google Fonts import, different `font-family` declarations across CSS variables.
- Page title casing: Add a strong "all-caps display" rule and apply it to page-level h1's across Talent Scout pages.
- Button casing: Add a CSS rule that uppercases primary CTA labels, OR change the labels in JSX. Prefer JSX so the rendered DOM is correct (better for screen readers + URL fragments).

The proposed full spec lives in `mirror-style-guide.md` next to this file.
