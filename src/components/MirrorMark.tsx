/**
 * Mirror NYC brand mark — the M wordmark with the underscore bar.
 * SVG sourced from `wireframe/Mirror Logo.svg`. Used in:
 *   - AppShell header (small, ~26px tall, top-left)
 *   - Landing.tsx (large, hero centerpiece)
 *
 * The SVG fills with `currentColor` so the parent's `text-*` utility wins.
 * Default sizing is height-driven; pass a `className` to override.
 */
export function MirrorMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 1911.95 2807.3"
      className={className}
      aria-hidden="true"
      fill="currentColor"
    >
      <path d="M0,2781.07v-260.16c0-14.48,11.74-26.23,26.23-26.23h1859.49c14.48,0,26.23,11.74,26.23,26.23v260.16c0,14.48-11.74,26.23-26.23,26.23H26.23c-14.48,0-26.23-11.74-26.23-26.23Z" />
      <path d="M26.23,0h302.82c9.15,0,17.64,4.77,22.4,12.58l580.92,953.79c10.17,16.7,34.38,16.8,44.68.18L1569.03,12.4c4.78-7.71,13.21-12.4,22.29-12.4h294.4c14.48,0,26.23,11.74,26.23,26.23v2041.24c0,14.48-11.74,26.23-26.23,26.23h-248.7c-14.48,0-26.23-11.74-26.23-26.23V474.4h-5.65l-540.58,865.5c-4.79,7.67-13.2,12.33-22.24,12.33h-178.38c-9.02,0-17.41-4.64-22.21-12.27L306.8,488.61h-5.65v1578.86c0,14.48-11.74,26.23-26.23,26.23H26.23c-14.48,0-26.23-11.74-26.23-26.23V26.23C0,11.74,11.74,0,26.23,0Z" />
    </svg>
  );
}
