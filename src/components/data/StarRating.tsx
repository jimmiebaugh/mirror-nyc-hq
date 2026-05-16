import { useState } from "react";

/**
 * Star rating used on Vendor Org detail + edit (Phase 5.2.2 § 6.B).
 *
 * Wireframe reference: OUTPUTS/phase-5-hq-wireframe-v1-LOCKED.html line 1955
 * (large 22px stars in the Vendor detail sidebar) and line 1842/1843/1845
 * (sm stars in the Organizations list Rating column). Off-stars use
 * `.stars .star-off`; filled stars use the wireframe-canonical `.stars`
 * `color:var(--warn)` token via the shared CSS block.
 *
 * Integer 0..max only (no half-stars per spec § 6.B). Editable mode renders
 * each star as a button; hover state previews the would-be value without
 * persisting until click.
 */

const SIZE_PX: Record<"sm" | "lg", number> = { sm: 14, lg: 22 };

export function StarRating({
  value,
  max = 5,
  size = "sm",
  editable = false,
  onChange,
}: {
  value: number | null;
  max?: number;
  size?: "sm" | "lg";
  editable?: boolean;
  onChange?: (next: number) => void;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const filledCount = hover ?? value ?? 0;
  const px = SIZE_PX[size];

  const stars = Array.from({ length: max }, (_, i) => {
    const filled = i < filledCount;
    const cls = filled ? "ic" : "ic star-off";
    if (editable) {
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
    return <Star key={i} className={cls} px={px} />;
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
