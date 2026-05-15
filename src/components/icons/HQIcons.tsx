/**
 * Phase 5.1 HQ Core icon set.
 *
 * Inline-SVG glyphs lifted 1:1 from the Phase 5 wireframe sprite (see
 * OUTPUTS/phase-5-hq-wireframe-v1-LOCKED.html lines 544-595). All glyphs use
 * `stroke="currentColor"` so a parent `text-*` utility drives the color.
 *
 * Pattern: each export is a stateless component that accepts a `className`
 * for sizing (default 18px square per `.ic` in the wireframe CSS) and an
 * optional `title` for screen readers.
 *
 * Why inline (and not Lucide): the wireframe sprite is the canonical visual,
 * Lucide's analogs read different. Keep the wireframe glyphs verbatim.
 */

import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { title?: string };

function Base({
  children,
  className,
  title,
  ...rest
}: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      {...rest}
    >
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  );
}

export const IconHome = (p: IconProps) => (
  <Base {...p}><path d="M3 11l9-8 9 8M5 10v10h14V10" /></Base>
);

export const IconProjects = (p: IconProps) => (
  <Base {...p}><path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" /></Base>
);

export const IconTasks = (p: IconProps) => (
  <Base {...p}>
    <path d="M9 6h11M9 12h11M9 18h11M4 5l1.5 1.5L8 4M4 11l1.5 1.5L8 10M4 17l1.5 1.5L8 16" />
  </Base>
);

export const IconDeliverables = (p: IconProps) => (
  <Base {...p}><path d="M5 3v18M5 4h12l-2.5 3.5L17 11H5" /></Base>
);

export const IconCalendar = (p: IconProps) => (
  <Base {...p}>
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M3 9h18M8 3v4M16 3v4" />
  </Base>
);

export const IconVenues = (p: IconProps) => (
  <Base {...p}>
    <path d="M12 21s-7-5.5-7-11a7 7 0 0114 0c0 5.5-7 11-7 11z" />
    <circle cx="12" cy="10" r="2.5" />
  </Base>
);

export const IconOrgs = (p: IconProps) => (
  <Base {...p}>
    <rect x="4" y="3" width="9" height="18" />
    <path d="M13 8h7v13h-7M7 7h3M7 11h3M7 15h3M16 12h2M16 16h2" />
  </Base>
);

export const IconPeople = (p: IconProps) => (
  <Base {...p}>
    <circle cx="9" cy="8" r="3.2" />
    <path d="M3.5 20c.6-3.2 2.9-5 5.5-5s4.9 1.8 5.5 5" />
    <circle cx="17.5" cy="9" r="2.6" />
    <path d="M16 14.4c2.2.2 4 1.9 4.5 4.6" />
  </Base>
);

export const IconActivity = (p: IconProps) => (
  <Base {...p}><path d="M3 12h4l3-8 4 16 3-8h4" /></Base>
);

export const IconSearch = (p: IconProps) => (
  <Base {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="M21 21l-4.3-4.3" />
  </Base>
);

export const IconScout = (p: IconProps) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M14.9 9.1l-2.1 5.8-5.8 2.1 2.1-5.8z" />
  </Base>
);

export const IconWiki = (p: IconProps) => (
  <Base {...p}>
    <path d="M5 4h11a3 3 0 013 3v13H8a3 3 0 01-3-3z" />
    <path d="M5 17a3 3 0 013-3h11" />
  </Base>
);

export const IconTeam = (p: IconProps) => (
  <Base {...p}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <circle cx="9" cy="10" r="2.4" />
    <path d="M5.5 16c.5-1.8 1.9-2.8 3.5-2.8s3 1 3.5 2.8M14.5 9h4M14.5 13h4" />
  </Base>
);

export const IconOutlook = (p: IconProps) => (
  <Base {...p}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M3 9h18M9 9v12M15 9v12" />
  </Base>
);

export const IconSettings = (p: IconProps) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 13.5a1.7 1.7 0 00.3 1.9 2 2 0 11-2.7 2.7 1.7 1.7 0 00-2.9 1.2V21a2 2 0 01-4 0 1.7 1.7 0 00-2.9-1.2 2 2 0 11-2.7-2.7A1.7 1.7 0 003.8 14H3a2 2 0 010-4 1.7 1.7 0 001.5-2.9A2 2 0 117.2 4.4 1.7 1.7 0 0010 3.2V3a2 2 0 014 0 1.7 1.7 0 002.8 1.4 2 2 0 112.7 2.7A1.7 1.7 0 0020.8 10H21a2 2 0 010 4h-.2a1.7 1.7 0 00-1.4 1z" />
  </Base>
);

export const IconBell = (p: IconProps) => (
  <Base {...p}>
    <path d="M6 9a6 6 0 1112 0c0 5 2 6 2 6H4s2-1 2-6" />
    <path d="M10 20a2 2 0 004 0" />
  </Base>
);

export const IconPlus = (p: IconProps) => (
  <Base {...p}><path d="M12 5v14M5 12h14" /></Base>
);

export const IconChevronRight = (p: IconProps) => (
  <Base {...p}><path d="M9 6l6 6-6 6" /></Base>
);

export const IconClock = (p: IconProps) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 3" />
  </Base>
);

export const IconExt = (p: IconProps) => (
  <Base {...p}>
    <path d="M14 4h6v6M20 4l-9 9M18 13v6a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h6" />
  </Base>
);

export const IconComment = (p: IconProps) => (
  <Base {...p}><path d="M4 5h16v11H9l-5 4z" /></Base>
);

export const IconCheck = (p: IconProps) => (
  <Base {...p}><path d="M4 12l5 5L20 6" /></Base>
);
