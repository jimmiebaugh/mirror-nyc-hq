import type { Config } from "tailwindcss";
import tailwindcssAnimate from "tailwindcss-animate";

export default {
  darkMode: ["class"],
  content: {
    files: ["./index.html", "./src/**/*.{ts,tsx}"],
    // Phase 5.16.1.1 (Build #5): neutralize JS-negation false positives before
    // the JIT scanner sees them. Tokens like `!row` (scanned out of `!row.read`)
    // are read as important-modified candidates; when one matches a component
    // class that has a rule inside a nested `@media` within `@layer components`
    // (here `.row` in src/index.css's max-width:640px block), Tailwind v3 emits
    // malformed EMPTY-SELECTOR `!important` rules. Lightning CSS (the Vite 8
    // default minifier) hard-errors on those; esbuild silently dropped them.
    // Strip the leading `!` from bare-word candidates (lowercase letters NOT
    // followed by a class-continuation char) so they never reach the scanner.
    // Hyphenated/bracketed important utilities (`!border-t-2`, `!bg-[...]`) are
    // preserved (next char is `-`/`[`). Build-scan only: never mutates source,
    // no runtime or cascade effect. Caveat: single-word important utilities
    // (`!flex`) won't generate under this transform; use the longhand or add to
    // `safelist`. None are used today.
    transform: {
      DEFAULT: (content: string) => content.replace(/!([a-z]+)(?![-/:[a-z0-9])/g, "$1"),
    },
  },
  // Safelist for dynamic-token classes constructed via template literals
  // (e.g. `pill p-${token}`, `rb-${token}`, `cal-ev ${kind}`). Tailwind's
  // content scanner cannot detect those suffixes statically, so the
  // matching @layer components rules in src/index.css get purged from
  // the production bundle. Without these entries, only the token variants
  // that happen to also appear as literals elsewhere in source survive,
  // which is why warn-token pills rendered correctly but info/success/
  // destructive/muted pills came back as bare dot+text on Home + List.
  safelist: [
    // Pills (Phase 5.2 wireframe-canonical + Phase 5.1 hq- prefix variants)
    "pill", "pill-sm", "pill-lg",
    "p-warn", "p-success", "p-info", "p-destructive", "p-primary", "p-muted", "p-purple",
    "p-aff-client", "p-aff-vendor", "p-aff-venue",
    // Calendar event banner kind classes (selectors are `.cal-ev.<kind>`)
    "cal-ev", "in", "live", "rem", "del",
    // Phase 5.3 Calendar additions: shared Outlook + Mirror Holiday banners
    "olk", "hol",
    // Phase 5.3 Outlook 12-month grid confidence-color modifiers
    // (selectors are `.ol-ev.<kind>` and `ol-${kind}` via confidenceClass())
    "ol-ev", "ol-rad", "ol-like", "ol-conf", "ol-comp",
    // Row-border tokens (`.tbl tr[.rb-<token>]`, `.bcard[.rb-<token>]`)
    "rb-warn", "rb-success", "rb-info", "rb-destructive", "rb-muted", "rb-purple",
    // Board + timeline elements referenced through dynamic JSX
    "bcard", "bcol", "tl-bar", "tl-name",
    // Phase 5.4 wiki + credentials + toggle classes (constructed dynamically
    // via template literals in WikiPage / CredentialRevealField / Team /
    // Settings Integrations).
    "wikilayout", "wikinav", "wikipage", "wn", "wn--active",
    "cred", "cv", "cv--masked", "ca",
    "toggle", "toggle--on",
    // Phase 5.5 notification bell + activity feed classes. Notif is built
    // dynamically (`notif notif--unread`) per row; activity-row + actdot
    // were already in src/index.css (Project Detail) but render here too.
    "notif", "notif--unread", "activity-row", "actdot",
    // Phase 5.7.5 follow-up round 1: deliverable board card background scale
    // (selectors are `.bcard.<bg-class>` driven by deliverableCardBg()).
    "bcard--bg-coral", "bcard--bg-amber", "bcard--bg-grey", "bcard--bg-green", "bcard--bg-skipped",
    // Phase 5.7.5 follow-up round 1: HQ Core edit-page input restyle wrapper.
    // Strips the standard outline + coral left border from .input/.input--filled
    // so form inputs match the RecordCombobox inline-edit chrome on hover/focus.
    "hq-form",
    // Phase 5.7.5 follow-up round 2: subgroup quick-add coral + button.
    "btn-quickadd",
    // Phase 5.12.14.3 Round 3 amendment v2 § 2: excluded ReviewCards dim
    // via conditional `opacity-40`. Template-literal conditional classes
    // can slip Tailwind's content scanner; safelist guarantees the
    // utilities ship. `grayscale` is the layered fallback per amendment
    // v2 § 2 if 40% alone reads too subtle.
    "opacity-40", "opacity-50", "grayscale",
  ],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      fontFamily: {
        // Three brand families per docs/visual-audit/mirror-style-guide.md.
        // Default `font-sans` resolves to Roboto so body prose hits the
        // right face by default. Display (Montserrat) + mono (Roboto Mono)
        // are explicit utilities for headlines and captions.
        sans: ["Roboto", "ui-sans-serif", "system-ui"],
        display: ["Montserrat", "ui-sans-serif", "system-ui"],
        mono: ["Roboto Mono", "ui-monospace", "SF Mono", "Menlo", "monospace"],
      },
      colors: {
        border: "hsl(var(--border))",
        "border-strong": "hsl(var(--border-strong))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        surface: {
          DEFAULT: "hsl(var(--surface))",
          alt: "hsl(var(--surface-alt))",
          raised: "hsl(var(--surface-raised))",
        },
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
          hover: "hsl(var(--primary-hover))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        subtle: {
          foreground: "hsl(var(--subtle-foreground))",
        },
        success: "hsl(var(--success))",
        warn: "hsl(var(--warn))",
        // Wired from --info / --purple in index.css so component code uses
        // text-info / bg-purple instead of hardcoding #06B6D4 / #B57BF5.
        info: "hsl(var(--info))",
        purple: "hsl(var(--purple))",
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "var(--radius)",
        sm: "var(--radius)",
      },
      keyframes: {
        "accordion-down": {
          from: {
            height: "0",
          },
          to: {
            height: "var(--radix-accordion-content-height)",
          },
        },
        "accordion-up": {
          from: {
            height: "var(--radix-accordion-content-height)",
          },
          to: {
            height: "0",
          },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [tailwindcssAnimate],
} satisfies Config;
