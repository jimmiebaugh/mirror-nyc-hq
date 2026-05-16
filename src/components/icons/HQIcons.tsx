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

// Phase 5.2 cleanup: distinct glyph for the Clients rail item so it
// reads differently from Vendors (which keeps IconOrgs). Briefcase
// shape evokes the revenue-side relationship; IconOrgs (office
// building) stays with Vendors for the operations-side semantic.
export const IconClients = (p: IconProps) => (
  <Base {...p}>
    <rect x="3" y="7" width="18" height="13" rx="2" />
    <path d="M8 7V5a2 2 0 012-2h4a2 2 0 012 2v2" />
    <path d="M3 13h18" />
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

export const IconList = (p: IconProps) => (
  <Base {...p}><path d="M3 6h18M3 12h18M3 18h18" /></Base>
);

export const IconBoard = (p: IconProps) => (
  <Base {...p}>
    <rect x="3" y="4" width="5" height="16" rx="1" />
    <rect x="10" y="4" width="5" height="11" rx="1" />
    <rect x="17" y="4" width="4" height="8" rx="1" />
  </Base>
);

export const IconTimeline = (p: IconProps) => (
  <Base {...p}>
    <path d="M3 6h10M5 12h14M3 18h8" />
  </Base>
);

export const IconFilter = (p: IconProps) => (
  <Base {...p}><path d="M3 5h18l-7 9v5l-4 2v-7z" /></Base>
);

export const IconX = (p: IconProps) => (
  <Base {...p}><path d="M6 6l12 12M18 6L6 18" /></Base>
);

export const IconChevronDown = (p: IconProps) => (
  <Base {...p}><path d="M6 9l6 6 6-6" /></Base>
);

export const IconArrowLeft = (p: IconProps) => (
  <Base {...p}><path d="M19 12H5M11 6l-6 6 6 6" /></Base>
);

export const IconDrive = (p: IconProps) => (
  <Base {...p}><path d="M7 5l5 9 5-9zM4 19l4-7M20 19l-4-7M4 19h16" /></Base>
);

export const IconSlack = (p: IconProps) => (
  <Base {...p}>
    <rect x="4" y="4" width="6" height="6" rx="1" />
    <rect x="14" y="4" width="6" height="6" rx="1" />
    <rect x="4" y="14" width="6" height="6" rx="1" />
    <rect x="14" y="14" width="6" height="6" rx="1" />
  </Base>
);

export const IconSlides = (p: IconProps) => (
  <Base {...p}>
    <rect x="3" y="4" width="18" height="13" rx="1" />
    <path d="M8 21h8M12 17v4" />
  </Base>
);

export const IconLink = (p: IconProps) => (
  <Base {...p}>
    <path d="M10 14a4 4 0 005.5 0l3-3a4 4 0 00-5.5-5.5L11 7" />
    <path d="M14 10a4 4 0 00-5.5 0l-3 3A4 4 0 0011 18.5l2-2" />
  </Base>
);

// Phase 5.4 wireframe sprite lifts (Surfaces 12, 17, 18, 20).
export const IconLock = (p: IconProps) => (
  <Base {...p}>
    <rect x="5" y="11" width="14" height="9" rx="1.5" />
    <path d="M8 11V8a4 4 0 018 0v3" />
  </Base>
);

export const IconEye = (p: IconProps) => (
  <Base {...p}>
    <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z" />
    <circle cx="12" cy="12" r="3" />
  </Base>
);

export const IconEyeOff = (p: IconProps) => (
  <Base {...p}>
    <path d="M2 12s4-7 10-7c2 0 3.7.7 5.2 1.6M22 12s-4 7-10 7c-2 0-3.7-.7-5.2-1.6M3 3l18 18M9.5 9.5a3 3 0 004 4" />
  </Base>
);

export const IconCopy = (p: IconProps) => (
  <Base {...p}>
    <rect x="9" y="9" width="12" height="12" rx="2" />
    <path d="M5 15V5a2 2 0 012-2h8" />
  </Base>
);

export const IconPencil = (p: IconProps) => (
  <Base {...p}>
    <path d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4" />
  </Base>
);

export const IconAlert = (p: IconProps) => (
  <Base {...p}>
    <path d="M12 4l9 16H3zM12 10v5M12 18h.01" />
  </Base>
);

export const IconStar = (p: IconProps) => (
  <Base {...p}>
    <path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" />
  </Base>
);
