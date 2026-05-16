import type { SVGProps } from "react";

/**
 * Phase 5.5.1 Google G icon (4-color brand mark).
 *
 * Lifted from the wireframe sprite definition (`#i-google-color`) in
 * OUTPUTS/phase-5-hq-wireframe-v1-LOCKED.html line 595. Used only on the
 * sign-in button on the Landing page; that button stays white per spec § 6
 * (the one HQ surface where coral does NOT win the primary CTA, because
 * Google brand guidelines require the 4-color G + their own button color).
 */
export function GoogleColorIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      {...props}
    >
      <path
        d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.4a4.62 4.62 0 01-2 3.03v2.52h3.24c1.9-1.75 2.96-4.33 2.96-7.38z"
        fill="#4285F4"
      />
      <path
        d="M12 22c2.7 0 4.97-.9 6.62-2.42l-3.24-2.52c-.9.6-2.05.96-3.38.96-2.6 0-4.8-1.76-5.59-4.12H3.07v2.59A10 10 0 0012 22z"
        fill="#34A853"
      />
      <path
        d="M6.41 13.9a6 6 0 010-3.84V7.47H3.07a10 10 0 000 9.02l3.34-2.59z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.95c1.47 0 2.79.5 3.83 1.5l2.85-2.86A10 10 0 003.07 7.47l3.34 2.59C7.2 7.71 9.4 5.95 12 5.95z"
        fill="#EA4335"
      />
    </svg>
  );
}
