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
 * Browser tab title stays "Mirror NYC HQ" (set in index.html). a11y is
 * intentionally not addressed for the sign-in trigger — internal-only tool
 * with a small known team.
 */
export default function Landing() {
  const { signInWithGoogle } = useAuth();

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
        className="select-none text-[14.4px] font-normal uppercase text-white"
      >
        <span style={{ letterSpacing: "0.18em" }}>
          STRATEGY&nbsp;&nbsp;/&nbsp;&nbsp;DESIGN&nbsp;&nbsp;/&nbsp;&nbsp;PRODUCTION
        </span>
      </div>
    </div>
  );
}

function MirrorMark() {
  // Authoritative Mirror wordmark — sourced from
  // ~/Documents/Claude/Projects/Venue Sourcing App/wireframe/Mirror Logo.svg.
  // Two paths: the underscore bar (y ~2520..2807) and the M character (y 0..2093).
  return (
    <svg
      viewBox="0 0 1911.95 2807.3"
      height="230"
      fill="white"
      aria-hidden="true"
    >
      <path d="M0,2781.07v-260.16c0-14.48,11.74-26.23,26.23-26.23h1859.49c14.48,0,26.23,11.74,26.23,26.23v260.16c0,14.48-11.74,26.23-26.23,26.23H26.23c-14.48,0-26.23-11.74-26.23-26.23Z" />
      <path d="M26.23,0h302.82c9.15,0,17.64,4.77,22.4,12.58l580.92,953.79c10.17,16.7,34.38,16.8,44.68.18L1569.03,12.4c4.78-7.71,13.21-12.4,22.29-12.4h294.4c14.48,0,26.23,11.74,26.23,26.23v2041.24c0,14.48-11.74,26.23-26.23,26.23h-248.7c-14.48,0-26.23-11.74-26.23-26.23V474.4h-5.65l-540.58,865.5c-4.79,7.67-13.2,12.33-22.24,12.33h-178.38c-9.02,0-17.41-4.64-22.21-12.27L306.8,488.61h-5.65v1578.86c0,14.48-11.74,26.23-26.23,26.23H26.23c-14.48,0-26.23-11.74-26.23-26.23V26.23C0,11.74,11.74,0,26.23,0Z" />
    </svg>
  );
}
