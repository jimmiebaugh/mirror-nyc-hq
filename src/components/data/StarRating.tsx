import { useState } from "react";

/**
 * Star rating used on Vendor detail + edit + list (Phase 5.2.2 § 6.B).
 *
 * Wireframe reference: OUTPUTS/phase-5-hq-wireframe-v1-LOCKED.html line 1955
 * (large 22px stars in the Vendor detail sidebar) and line 1842/1843/1845
 * (sm stars in the Organizations list Rating column). Off-stars use
 * `.stars .star-off`; filled stars use the wireframe-canonical `.stars`
 * `color:var(--warn)` token via the shared CSS block.
 *
 * Phase 5.7.13: half-star rendering added for read-only mode (team
 * aggregate display); editable mode stays integer-only. `md` (18px) size
 * added for the per-user-rating row in the VendorDetail Team Rating card.
 */

const SIZE_PX: Record<"sm" | "md" | "lg", number> = { sm: 14, md: 18, lg: 22 };

export function StarRating({
  value,
  max = 5,
  size = "sm",
  editable = false,
  onChange,
}: {
  value: number | null;
  max?: number;
  size?: "sm" | "md" | "lg";
  editable?: boolean;
  onChange?: (next: number) => void;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const px = SIZE_PX[size];

  const stars = Array.from({ length: max }, (_, i) => {
    if (editable) {
      // Editable mode is integer-only. Hover preview + click both emit
      // a whole-number rating; no half-star UX on click.
      const filledCount = hover ?? value ?? 0;
      const filled = i < filledCount;
      const cls = filled ? "ic" : "ic star-off";
      return (
        <button
          key={i}
          type="button"
          aria-label={`Set rating to ${i + 1}`}
          className="star-btn"
          style={{
            background: "transparent",
            border: 0,
            padding: 0,
            cursor: "pointer",
            display: "inline-flex",
          }}
          onMouseEnter={() => setHover(i + 1)}
          onMouseLeave={() => setHover(null)}
          onClick={() => onChange?.(i + 1)}
        >
          <Star className={cls} px={px} />
        </button>
      );
    }
    // Read-only mode supports fractional values (team aggregate).
    const v = value ?? 0;
    if (v >= i + 1) return <Star key={i} className="ic" px={px} />;
    if (v > i) return <HalfStar key={i} px={px} />;
    return <Star key={i} className="ic star-off" px={px} />;
  });

  return (
    <span
      className="stars"
      style={{ display: "inline-flex", gap: 2, alignItems: "center" }}
    >
      {stars}
    </span>
  );
}

function Star({ className, px }: { className: string; px: number }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      style={{ width: px, height: px }}
      fill={className.includes("star-off") ? "none" : "currentColor"}
      stroke="currentColor"
      strokeWidth={className.includes("star-off") ? 1.5 : 0}
    >
      <path d="M12 17.27l5.18 3.13-1.37-5.89 4.55-3.94-6.01-.52L12 4.5l-2.35 5.55-6.01.52 4.55 3.94-1.37 5.89z" />
    </svg>
  );
}

function HalfStar({ px }: { px: number }) {
  // Two stacked stars: off-star background, filled-star overlay clipped
  // to the left half. Reads identically to a full or empty star at the
  // same call site since the wrapper inherits the parent's flex baseline.
  return (
    <span
      style={{
        position: "relative",
        display: "inline-flex",
        width: px,
        height: px,
      }}
    >
      <Star className="ic star-off" px={px} />
      <span
        style={{
          position: "absolute",
          inset: 0,
          width: px / 2,
          overflow: "hidden",
        }}
      >
        <Star className="ic" px={px} />
      </span>
    </span>
  );
}
