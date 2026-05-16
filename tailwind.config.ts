import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./pages/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
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
    "hq-pill", "hq-pill--warn", "hq-pill--success", "hq-pill--info", "hq-pill--destructive", "hq-pill--muted",
    // Calendar event banner kind classes (selectors are `.cal-ev.<kind>`)
    "cal-ev", "in", "live", "rem", "del",
    // Phase 5.3 Calendar additions: shared Outlook + Mirror Holiday banners
    "olk", "hol",
    // Phase 5.3 Outlook 12-month grid confidence-color modifiers
    // (selectors are `.ol-ev.<kind>` and `ol-${kind}` via confidenceClass())
    "ol-ev", "ol-rad", "ol-like", "ol-conf", "ol-comp",
    // Row-border tokens (`.tbl tr[.rb-<token>]`, `.bcard[.rb-<token>]`)
    "rb-warn", "rb-success", "rb-info", "rb-destructive", "rb-muted",
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
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
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
  plugins: [require("tailwindcss-animate")],
} satisfies Config;
