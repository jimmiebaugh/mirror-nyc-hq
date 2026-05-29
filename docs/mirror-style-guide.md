# Mirror NYC HQ: proposed style guide

Pre-implementation proposal for Jimmie's review. Synthesized from three inputs:
- The Mirror NYC blank deck template (`BLANK DECK TEMPLATE (2026).pptx`): **brand authority**
- The Talent Scout source app: reference for component patterns, not brand authority
- The current HQ build: preserves the compactness and density Jimmie likes

The deck template's master slide settings nail down exact font families, weights, and hex values. Everything below is sourced from those: no guesswork.

## Design philosophy

**Architectural minimalism with restrained coral.** The deck's brand DNA is white display + black surface + Roboto Mono utility text + a single dusty coral used sparingly as accent. HQ should read like a piece of Mirror's brand system, not a generic SaaS dashboard.

**Density stays.** Mirror's deck is a presentation; HQ is a dashboard. The deck has space because it's a slide, not because Mirror loves whitespace. HQ keeps its compact stat tiles, tight tables, thin header bar.

**Coral is an accent, not a color scheme.** In the deck, coral appears on three things: section numerals, the "DATE | LOCATION" eyebrow caption, and one full-bleed background pop page. That's it. HQ should feel similarly restrained: coral on primary actions, accent text, the active brand mark: but most of the UI reads in white-on-black with mono captions doing the labeling work.

## 1. Color palette

All values sourced from `BLANK DECK TEMPLATE (2026).pptx` slide-master XML. The shipped token table (hex + HSL + usage, matching the locked `src/index.css`) lives in `docs/design-system.md` § 1 Tokens, canonical. The deck-voice notes below are the part that lives nowhere else.

**Notes on coral:** The deck's coral is `#BE4E44`: duskier and more terracotta than the source app's `#ef5b5b`. On a black background it reads more "Mirror branded" and less "consumer-tech CTA red." This is the single biggest token change vs Phase 3.5b's current branch.

The deck also has the `#BE4E44` muted-coral as a full-bleed background fill on the "Event Vibe" pop page. HQ's only equivalent surface that could use this treatment is the Coming Soon landing page: keep on pure black for now; reserve the pop-coral background for a future mood/marketing page if needed.

**Restraint test:** if more than 8% of any HQ screen is coral, you're using too much. Look at the deck: coral is a 16pt caption + a 110pt numeral + nothing else.

## 2. Typography

### Font stack

| Role | Family | Weights loaded |
| --- | --- | --- |
| Display | **Montserrat** | 400 (regular), 800 (ExtraBold) |
| Body | **Roboto** | 300 (Light), 400 (regular), 500 (Medium) |
| Caption / utility / labels | **Roboto Mono** | 300 (Light), 400 (regular), 500 (Medium), 700 (Bold) |

Google Fonts import:
```css
@import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@400;800&family=Roboto:wght@300;400;500&family=Roboto+Mono:wght@300;400;500;700&display=swap');
```

### CSS variables

```css
--font-display: 'Montserrat', ui-sans-serif, system-ui, sans-serif;
--font-body: 'Roboto', ui-sans-serif, system-ui, sans-serif;
--font-mono: 'Roboto Mono', ui-monospace, 'SF Mono', Menlo, monospace;
```

### Type scale

The deck uses 36pt hero titles and 16pt accent captions on a presentation slide; HQ scales that down for dashboard viewing distance. The shipped type utility class specs (sizes, weights, tracking, casing, matching `src/index.css`) are canonical in `docs/design-system.md` § 1 Type. (An earlier approximate table here had diverged from the shipped CSS, so it was dropped; `design-system.md` wins on any conflict.)

### Why all-caps everywhere

It's not "Mirror loves yelling." All-caps + Roboto Mono is the deck's caption system: every navigation eyebrow, every page-numeric, every label-on-content-slide is mono caps. Adopting that across HQ's labels gets the brand DNA without changing any layout. Body paragraphs and table data stay sentence case: those aren't captions.

## 3. Component conventions

Applied className specs for these components (button / pill / tier-badge / input / card / header-nav / eyebrow / page-title sizing) were promoted to `docs/design-system.md` in the Phase 5 reconciliation; that doc is canonical. What follows is the brand-signal voice that lives nowhere else.

### Buttons

**Coral restraint:** only ONE primary coral button per visible viewport. Everything else is secondary (ghost outline) or tertiary (text-only). Casing: keep sentence/title case in source strings and let the component class apply uppercase where the system calls for it; avoid all-caps source labels for working-app commands.

### Pills (status, tier, R-round)

Every pill gets a 6px round dot prefix (`bg-current`): that's the deck's micro-marker pattern. The R-round pill carries coral primary; status and tier pills draw from the success / warn / destructive signal colors.

### Tier badges (scorecard)

Tier 1 Must-Haves = destructive, Tier 2 Strong Differentiators = warn, Tier 3 Nice-to-Haves = success, Bonus Competitor Experience = coral primary. Hex + applied classes in `docs/design-system.md` § 1.

### StatusDropdown (candidate status)

Status dropdowns don't appear in the deck, so interview cyan and fast-track purple are bright non-brand neutrals used only on inline controls where statuses need to be quickly distinguishable. Hex values are canonical in `docs/design-system.md` § 1 (`--info` cyan, `--purple`).

### Inputs

Focus ring is 3px coral at 15%: the deck's accent treatment. In wizard flows, a `border-l-2 border-l-primary` left edge marks completed-step inputs. Sizing canon in `docs/design-system.md` § 1.

### Cards / panels

Pure flat, no shadow. Background starts from `--surface` (barely lifted off black) for quieter default panels; applied HQ sectioned content cards use `--surface-alt`. Padding + sizing canon in `docs/design-system.md` § 1 Spacing + radius + Component sizing.

### Header / nav

Brand wordmark is "Mirror NYC HQ" with the "HQ" suffix in coral primary, Montserrat ExtraBold display. Applied nav-bar / wordmark / nav-link specs in `docs/design-system.md`.

### Eyebrow caption (the `TALENT SCOUT` / `← BACK TO ROLE` pattern)

A small coral mono-caps caption sits above every page title to create the deck's hierarchy of "small mono caption → big Montserrat title." Applied className in `docs/design-system.md`.

### Page title (h1)

Big Montserrat ExtraBold uppercase, same treatment for role names, candidate names, and settings titles. Applied className in `docs/design-system.md`.

### Side rail (optional decorative, not a system pattern)

The deck's vertical "STRATEGY / DESIGN / PRODUCTION" + "MIRROR NYC" rail with a connector line is a strong brand signal but probably too decorative for a working dashboard. **Recommend NOT adopting** as a system pattern. Reserve for the Coming Soon landing page (where it already lives, kind of) and any future marketing pages.

## 4. Locked decisions (history)

The brand foundation (dusty coral, Montserrat/Roboto Mono/Roboto stack, all-caps titles, coral restraint, side-rail kept off the dashboard) was locked in Phase 3.5b; rationale in `docs/decisions.md`, phase narration in `docs/v1-changelog.md`.

## 5. What this style guide does NOT cover

- Accessibility (color contrast against pure black for muted-foreground was checked: 78% white on 0% black hits ~14:1, AAA: fine. Coral `#BE4E44` against black is 4.6:1, AA only. For text >= 18px or 14px-bold, this passes; for smaller body text on coral, use white on coral instead.)
- Motion / transitions (defer to Phase 5 polish)
- Marketing surfaces (deck is its own thing; future mirrornyc.com refresh is out of scope)
- Email templates (Phase 3.8)
- Dark/light mode toggle (HQ is dark-only, settled)
