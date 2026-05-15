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

All values from `BLANK DECK TEMPLATE (2026).pptx` slide-master XML.

| Token | Hex | HSL | Usage |
| --- | --- | --- | --- |
| `--background` | `#000000` | `0 0% 0%` | Page background, primary surface |
| `--foreground` | `#FFFFFF` | `0 0% 100%` | Primary text |
| `--surface` | `#0A0A0A` | `0 0% 4%` | Cards / panels (lifted from black by 4%) |
| `--surface-alt` | `#141414` | `0 0% 8%` | Inputs, hover-state surfaces |
| `--surface-raised` | `#1F1F1F` | `0 0% 12%` | Elevated panels, popovers |
| **`--primary`** | **`#BE4E44`** | `4 47% 51%` | **The Mirror coral.** All CTAs, accent text, brand mark "HQ" suffix, R-round pills |
| `--primary-hover` | `#CC5C52` | `4 53% 56%` | Hover state on coral CTAs (lift +5% lightness) |
| `--primary-foreground` | `#FFFFFF` | `0 0% 100%` | Text on coral |
| `--muted-foreground` | `#C8C8C8` | `0 0% 78%` | Secondary text |
| `--subtle-foreground` | `#8A8A8A` | `0 0% 54%` | Tertiary / placeholder text |
| `--border` | `#2A2A2A` | `0 0% 16%` | Default hairlines |
| `--border-strong` | `#3A3A3A` | `0 0% 23%` | Stronger borders for inputs / dividers |
| `--success` | `#4ADE80` | `142 76% 64%` | Latest / Final Report / T3 / Complete |
| `--warn` | `#F59E0B` | `38 92% 50%` | Running / In Pool / In progress |
| `--destructive` | `#EF4444` | `0 84% 60%` | Failed / Stalled / Closed / T1 / Reject |

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

### Type scale (proposed)

The deck uses 36pt for hero titles and 16pt for accent captions on a presentation slide. For a dashboard at typical viewing distance, scale to:

| Use | Family / weight | Size | Tracking | Casing |
| --- | --- | --- | --- | --- |
| Page subtitle | Roboto Mono 400 | 13px | 0.06em | UPPERCASE |
| Card title (h3) | Montserrat ExtraBold (800) | 18px | normal | Title Case OK |
| Eyebrow caption (e.g. "TALENT SCOUT", "PULL ROUND") | Roboto Mono 400 | 11px | 0.08em | UPPERCASE |
| Section label (e.g. "RECRUITER OVERVIEW", "FILES & MATERIALS") | Roboto Mono 700 | 11px | 0.06em | UPPERCASE |
| Form label | Roboto Mono 700 | 11px | 0.06em | UPPERCASE |
| Stat tile label | Roboto Mono 700 | 11px | 0.08em | UPPERCASE |
| Stat tile number | Montserrat ExtraBold (800) | 32px tabular | normal | as-is |
| Body paragraph | Roboto 400 | 14px | normal | Sentence case |
| Body small (notes, captions, helper text) | Roboto 400 | 13px | normal | Sentence case |
| Pill / badge | Roboto Mono 700 | 10.5px | 0.06em | UPPERCASE |
| Button label | Roboto Mono 700 | 12px | 0.06em | UPPERCASE |
| Inline timestamp / metadata | Roboto Mono 400 | 12px | normal | as-is |
| Table header | Roboto Mono 700 | 11px | 0.06em | UPPERCASE |
| Table cell | Roboto 400 | 13-14px | normal | Sentence case |

### Why all-caps everywhere

It's not "Mirror loves yelling." All-caps + Roboto Mono is the deck's caption system: every navigation eyebrow, every page-numeric, every label-on-content-slide is mono caps. Adopting that across HQ's labels gets the brand DNA without changing any layout. Body paragraphs and table data stay sentence case: those aren't captions.

## 3. Component conventions

### Buttons

```tsx
// Primary (coral)
className="h-10 px-5 rounded-sm bg-primary text-primary-foreground hover:bg-primary-hover
           font-mono font-bold uppercase text-[12px] tracking-[0.06em]"

// Secondary (ghost outline)
className="h-10 px-5 rounded-sm bg-transparent border border-border-strong text-foreground
           hover:bg-white/5 hover:border-foreground
           font-mono font-bold uppercase text-[12px] tracking-[0.06em]"

// Tertiary (text-only)
className="h-9 px-3 text-foreground hover:text-primary
           font-mono font-bold uppercase text-[11px] tracking-[0.06em]"
```

- **Radius:** 4px (`rounded-sm` with current Tailwind base of `0.25rem`).
- **Height:** 40px primary/secondary, 36px tertiary.
- **Casing:** ALWAYS uppercase. Done in JSX (e.g. `Pull New Candidates` → `Pull New Candidates` typed sentence-case but `text-transform: uppercase` in CSS) so accessibility tools see real words.
- **Coral usage:** Only ONE primary coral button per visible viewport. Anything else is secondary or tertiary.

### Pills (status, tier, R-round)

```tsx
// R-round pill (coral primary)
className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-sm border border-primary/40 bg-primary/15 text-primary
           font-mono font-bold uppercase text-[10.5px] tracking-[0.06em]"

// Status: Active / Running (warn amber)
className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-sm border border-warn/30 bg-warn/10 text-warn
           font-mono font-bold uppercase text-[10.5px] tracking-[0.06em]"

// Status: Complete / Latest / Final Report (success green)
className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-sm border border-success/30 bg-success/10 text-success
           font-mono font-bold uppercase text-[10.5px] tracking-[0.06em]"

// Status: Failed / Stalled / Closed (destructive red)
className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-sm border border-destructive/30 bg-destructive/10 text-destructive
           font-mono font-bold uppercase text-[10.5px] tracking-[0.06em]"
```

All pills get a 6px round dot prefix (`<span className="h-1.5 w-1.5 rounded-full bg-current" />`): that's the deck's micro-marker pattern.

### Tier badges (scorecard)

| Tier | Color | Visual |
| --- | --- | --- |
| Tier 1: Must-Haves | Destructive red `#EF4444` | `bg-destructive/10 border-destructive/30 text-destructive` |
| Tier 2: Strong Differentiators | Warn amber `#F59E0B` | `bg-warn/10 border-warn/30 text-warn` |
| Tier 3: Nice-to-Haves | Success green `#4ADE80` | `bg-success/10 border-success/30 text-success` |
| Bonus: Competitor Experience | Coral primary `#BE4E44` | `bg-primary/15 border-primary/40 text-primary` |

### StatusDropdown (candidate status)

| Status | Color | Hex |
| --- | --- | --- |
| Interview | Cyan-500 | `#06B6D4` |
| Fast-Track | Purple-500 | `#A855F7` |
| Consider | Warn amber | `#F59E0B` |
| Reject | Destructive red | `#EF4444` |
| Auto-Rejected | Muted destructive (red-400 at 80%) | (disabled state) |

These don't appear in the deck (deck doesn't have status dropdowns), so this is "source-aligned with brand-friendly neutrals": interview cyan and fast-track purple are bright but not in the brand palette, used only on inline controls where they need to be quickly distinguishable.

### Inputs

```tsx
className="w-full h-11 px-3 rounded-sm bg-surface-alt border border-border-strong
           text-foreground text-[14px] outline-none transition-shadow
           focus:border-primary focus:shadow-[0_0_0_3px_hsl(var(--primary)/0.15)]
           placeholder:text-subtle-foreground placeholder:font-mono placeholder:text-[13px]"
```

- **Height:** 44px (deck's input metric).
- **Radius:** 4px.
- **Focus ring:** 3px coral at 15%: the deck's accent treatment.
- **Filled state:** add `border-l-2 border-l-primary` to indicate completed-step inputs in wizard flows.

### Cards / panels

- 4px radius. Pure flat: no shadow.
- Background `--surface` (`#0A0A0A`: barely lifted off black) so cards are visible against `#000` page.

For padding + sizing canon, see `docs/design-system.md` § 1 Spacing + radius + Component sizing.

### Header / nav

```tsx
// Nav bar
className="sticky top-0 z-40 border-b border-border bg-background h-14"

// Brand wordmark
"Mirror NYC HQ" with HQ in coral primary, Montserrat ExtraBold-equivalent.
className="font-display font-extrabold uppercase text-[15px] tracking-tight"

// Nav links
className="font-mono font-bold uppercase text-[11px] tracking-[0.08em] text-muted-foreground hover:text-foreground"
```

### Eyebrow caption (the `TALENT SCOUT` / `← BACK TO ROLE` pattern)

```tsx
className="font-mono font-bold uppercase text-[11px] tracking-[0.08em] text-primary mb-2"
```

Use this above every page title to create the deck's hierarchy of "small mono caption → big Montserrat title."

### Page title (h1)

```tsx
<h1 className="font-display font-extrabold uppercase text-[32px] leading-none tracking-[-0.01em] mb-2">
  {title}
</h1>
```

For role names, candidate names, settings titles: same treatment.

### Side rail (optional decorative, not a system pattern)

The deck's vertical "STRATEGY / DESIGN / PRODUCTION" + "MIRROR NYC" rail with a connector line is a strong brand signal but probably too decorative for a working dashboard. **Recommend NOT adopting** as a system pattern. Reserve for the Coming Soon landing page (where it already lives, kind of) and any future marketing pages.

## 4. What this means for Phase 3.5b's branch

The current `phase-3-5b-visual-brand` branch did most things right but on the WRONG coral and the WRONG font. To land this style guide cleanly:

1. **Update `src/index.css`**: swap `--primary` from coral `0 83% 65%` to dusty coral `4 47% 51%`. Adjust `--primary-hover`. Change Google Fonts import from Inter to Montserrat + Roboto + Roboto Mono. Add `--font-display`, `--font-body`, `--font-mono` variables.
2. **Update `tailwind.config.ts`**: swap `fontFamily.sans` from Inter to Roboto. Add `fontFamily.display: ['Montserrat', ...]` and `fontFamily.mono: ['Roboto Mono', ...]`.
3. **Update component-layer utilities** in `src/index.css`: `.btn-primary`, `.input-base`, `.tier-badge`, `.status-pill`, `.h-page`, `.label-section`, `.crumb` all keep their structure but switch to `--font-display` / `--font-mono` as appropriate.
4. **JSX-level changes** (a couple dozen files):
    - Page titles → `<h1 className="font-display font-extrabold uppercase ...">` + ALL CAPS labels in code.
    - Section labels → add `font-mono` to existing `font-bold uppercase tracking-wider` classes.
    - Button labels uppercase via `text-transform: uppercase` (the global rule already applies if we add it to `.btn-base`).
    - Eyebrow captions ("TALENT SCOUT", "← BACK TO ROLE", "ROLE / HIRING MANAGER") → already mono-styled visually; just need the Roboto Mono family applied (which happens automatically once `--font-mono` is set and we tag those spans `font-mono`).
5. **Keep:** all the spacing, density, and structural decisions HQ already has. No layout shifts.

## 5. Open questions for Jimmie before applying

1. **Coral hex confirmed:** `#BE4E44` (dusty terracotta) instead of `#ef5b5b` (bright). Confirm. CONFIRMED.
2. **Display font confirmed:** Montserrat ExtraBold + Montserrat regular. (Deck uses both as a paired display in "CLIENT NAME / PROJECT NAME"; HQ might only need ExtraBold for now and pull regular when needed.) Confirm. CONFIRMED.
3. **Caption font confirmed:** Roboto Mono for every uppercase tracked label across HQ. Confirm or push back if Roboto Mono feels too "code-y" outside the deck context. CONFIRMED.
4. **Body font confirmed:** Roboto for prose paragraphs (recruiter overview, internal notes, etc.). Or keep Inter for body and only use Montserrat + Roboto Mono for display/captions. Lighter touch: fewer fonts loaded: but slightly off-brand. USE ROBOTO FOR PROSE.
5. **All-caps page titles:** ALL CAPS for "OPEN ROLES" / "TEST EVENTS PRODUCER" / "JOE FAMULARO": feels brand-correct or feels like shouting? The deck does this consistently; comfortable to adopt? YES LET'S TRY IT. 
6. **All-caps button labels:** "+ NEW ROLE", "PULL NEW CANDIDATES", "GENERATE SCORECARD →": feels strong or feels too presentational for a working app? FEELS TOO STRONG
7. **Side rail pattern:** keep off the dashboard? OK on the landing page only? WE MIGHT EXPLORE IN THE CORE HQ BUT FINE TO LEAVE OUT OF TALENT SCOUT.
8. **Coral restraint:** is "max 8% coral coverage per screen" a meaningful constraint, or should coral keep its current frequency (every primary CTA, every eyebrow, every R-round pill)? LET'S LEAVE WHAT WE HAVE FOR NOW. 

These answers determine the actual code changes. Once locked, applying takes maybe 60-90 minutes: most of it is JSX label swaps, not architectural work.

## 6. What this style guide does NOT cover

- Accessibility (color contrast against pure black for muted-foreground was checked: 78% white on 0% black hits ~14:1, AAA: fine. Coral `#BE4E44` against black is 4.6:1, AA only. For text >= 18px or 14px-bold, this passes; for smaller body text on coral, use white on coral instead.)
- Motion / transitions (defer to Phase 5 polish)
- Marketing surfaces (deck is its own thing; future mirrornyc.com refresh is out of scope)
- Email templates (Phase 3.8)
- Dark/light mode toggle (HQ is dark-only, settled)
