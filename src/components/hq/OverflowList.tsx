import { Link } from "react-router-dom";
import type { ReactNode } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

/**
 * Inline hyperlink list with "+N more" overflow popover (Phase 5.6.2
 * spec § 7). Used by ClientsList (Contacts / Deliverables / Projects
 * columns) and VendorsList (Capabilities / Projects columns) plus
 * VendorDetail Projects.
 *
 * Renders the first `visible` items as comma-separated tlinks; if more
 * exist, appends a muted-text "+N more" trigger that opens a Popover
 * stacking the remaining items as a vertical hyperlink list. Each link
 * stopPropagation's so it does not fire a row-click. When `href` is null,
 * the item renders as a non-link span (used by capability chips).
 */

export type OverflowItem = {
  id: string;
  label: string;
  href: string | null;
};

export type OverflowListProps = {
  items: OverflowItem[];
  visible?: number;
  emptyPlaceholder?: ReactNode;
  /** Wrap each rendered item in a chip class instead of a plain link. */
  asChip?: boolean;
};

function renderItem(item: OverflowItem, asChip: boolean) {
  if (item.href) {
    return (
      <Link
        to={item.href}
        className={asChip ? "tag" : "tlink"}
        onClick={(e) => e.stopPropagation()}
      >
        {item.label}
      </Link>
    );
  }
  return <span className={asChip ? "tag" : undefined}>{item.label}</span>;
}

export function OverflowList({
  items,
  visible = 3,
  emptyPlaceholder = <span className="muted subtle">-</span>,
  asChip = false,
}: OverflowListProps) {
  if (items.length === 0) {
    return <>{emptyPlaceholder}</>;
  }

  const head = items.slice(0, visible);
  const rest = items.slice(visible);

  if (asChip) {
    return (
      <span
        className="row-c wrap"
        style={{ display: "inline-flex", gap: 6 }}
      >
        {head.map((item) => (
          <span key={item.id}>{renderItem(item, true)}</span>
        ))}
        {rest.length > 0 ? <MoreButton items={rest} asChip /> : null}
      </span>
    );
  }

  return (
    <span style={{ display: "inline" }}>
      {head.map((item, idx) => (
        <span key={item.id}>
          {idx > 0 ? <span className="muted subtle">, </span> : null}
          {renderItem(item, false)}
        </span>
      ))}
      {rest.length > 0 ? (
        <>
          <span className="muted subtle">, </span>
          <MoreButton items={rest} />
        </>
      ) : null}
    </span>
  );
}

function MoreButton({ items, asChip = false }: { items: OverflowItem[]; asChip?: boolean }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="cap muted"
          style={{
            background: "transparent",
            border: 0,
            padding: 0,
            cursor: "pointer",
            textDecoration: "underline",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          +{items.length} more
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[240px] p-3"
        onClick={(e) => e.stopPropagation()}
      >
        <ul
          className="stack-2"
          style={{ listStyle: "none", padding: 0, margin: 0 }}
        >
          {items.map((item) => (
            <li key={item.id}>{renderItem(item, asChip)}</li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
