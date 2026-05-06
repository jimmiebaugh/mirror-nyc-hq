import { useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";

/**
 * Stealth coming-soon landing for unauthenticated visitors at /.
 *
 * The "STRATEGY  /  DESIGN  /  PRODUCTION" line at the bottom is the
 * (hidden) sign-in trigger. Internal team is told to click it; everyone
 * else just sees a static brand mark. No visible affordance:
 *   - default cursor (no pointer)
 *   - no underline / no hover color shift / no role / no aria-label
 *   - tabIndex -1 so it isn't keyboard-focusable
 *
 * a11y is intentionally not addressed for this trigger — internal-only tool
 * with a small known team. See the prompt's a11y note.
 */
export default function Landing() {
  const { signInWithGoogle } = useAuth();

  useEffect(() => {
    document.title = "Mirror NYC";
    return () => {
      document.title = "Mirror NYC HQ";
    };
  }, []);

  return (
    <div className="flex min-h-screen w-full flex-col items-center justify-center bg-black px-6 py-12">
      <div className="flex flex-1 items-center justify-center">
        <MirrorMark />
      </div>
      <div
        onClick={() => {
          void signInWithGoogle();
        }}
        // Inline style overrides so this stays default cursor / no
        // pointer-events visual indication regardless of global CSS.
        style={{ cursor: "default", userSelect: "none" }}
        tabIndex={-1}
        className="select-none text-[12px] font-normal uppercase text-white"
      >
        <span style={{ letterSpacing: "0.18em" }}>
          STRATEGY&nbsp;&nbsp;/&nbsp;&nbsp;DESIGN&nbsp;&nbsp;/&nbsp;&nbsp;PRODUCTION
        </span>
      </div>
    </div>
  );
}

function MirrorMark() {
  // M with V-notch at top + separate underscore bar below. Approximates the
  // brand mark in the deck template (BLANK DECK TEMPLATE 2026).
  return (
    <svg
      viewBox="0 0 200 240"
      width="160"
      height="192"
      fill="white"
      aria-hidden="true"
    >
      <rect x="0" y="0" width="42" height="180" />
      <rect x="158" y="0" width="42" height="180" />
      <polygon points="42,0 158,0 100,90" />
      <rect x="42" y="202" width="116" height="24" />
    </svg>
  );
}
