// Shared packet infrastructure for ts-packet-generate (round) +
// ts-final-review-packet (review). Phase 3.6.1 rewrite: dropped CloudConvert
// entirely (Jimmie's call — account closed, HTML→PDF was unreliable). Now
// renders directly via pdf-lib using StandardFonts. Visual polish drops a
// notch (Helvetica vs Inter, no inline SVG wordmark) but ships reliably and
// is fully self-contained inside the Edge Function runtime.
//
// What stays: the merge of PDF attachments (resumes), the Storage upload +
// signed URL flow, the Gmail-send-with-attachment email step. DOCX
// attachments are no longer converted in-line; they're listed by filename
// on the candidate's title page but not embedded.

import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from "https://esm.sh/pdf-lib@1.17.1";
import { getGmailAccessToken } from "./gmailServiceAccount.ts";

// ============================================================================
// Layout constants — US Letter portrait, 72 dpi.
// ============================================================================
export const PAGE_W = 612;
export const PAGE_H = 792;
export const MARGIN_X = 50;
export const MARGIN_TOP = 60;
export const MARGIN_BOTTOM = 60;
export const CONTENT_W = PAGE_W - MARGIN_X * 2;

// Mirror brand palette mapped to pdf-lib rgb (0–1 floats).
export const C_BLACK = rgb(0, 0, 0);
export const C_WHITE = rgb(1, 1, 1);
export const C_CORAL = rgb(0.745, 0.306, 0.267); // #BE4E44
export const C_TEXT = rgb(0.1, 0.1, 0.1); // near-black on light pages
export const C_MUTED = rgb(0.42, 0.42, 0.42);
export const C_SUBTLE = rgb(0.6, 0.6, 0.6);
export const C_BORDER = rgb(0.85, 0.85, 0.85);
export const C_TIER1 = rgb(0.937, 0.267, 0.267); // red-500 #ef4444
export const C_TIER2 = rgb(0.961, 0.620, 0.043); // amber-500 #f59e0b
export const C_TIER3 = rgb(0.290, 0.871, 0.502); // green-400 #4ade80

// Tier accent for the Final Review packet's tier pills + card stripes.
export function tierColor(tier: string | null | undefined) {
  switch (tier) {
    case "top_recommendation":
    case "fast_track": return C_TIER3;
    case "strong_consideration": return C_TIER2;
    case "not_recommended":
    case "borderline": return C_TIER1;
    default: return C_MUTED;
  }
}

// ============================================================================
// String / date helpers
// ============================================================================
export function fmtDateLong(d: Date): string {
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}
export function fmtDateShort(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
export function slug(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "role";
}

// ============================================================================
// Packet context: fonts + working PDFDocument + page cursor.
// ============================================================================
export type PacketCtx = {
  doc: PDFDocument;
  helv: PDFFont;
  helvBold: PDFFont;
  /** Current page being drawn on. Functions like ensureSpace() can advance it. */
  page: PDFPage;
  /** Y coordinate of the next baseline (PDF coordinates: origin bottom-left, y grows up). */
  y: number;
  /** 1-based page counter for footers. */
  pageNum: number;
  /** Header text shown on every content page (top-left). Cover page skips it. */
  header: string;
};

export async function createPacketCtx(header: string): Promise<PacketCtx> {
  const doc = await PDFDocument.create();
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const helvBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([PAGE_W, PAGE_H]);
  return {
    doc, helv, helvBold,
    page,
    y: PAGE_H - MARGIN_TOP,
    pageNum: 1,
    header,
  };
}

/** Add a fresh white content page; reset cursor; draw header + page-number. */
export function newContentPage(ctx: PacketCtx) {
  ctx.page = ctx.doc.addPage([PAGE_W, PAGE_H]);
  ctx.pageNum += 1;
  ctx.y = PAGE_H - MARGIN_TOP;
  drawContentChrome(ctx);
}

function drawContentChrome(ctx: PacketCtx) {
  // Header text — small uppercase
  ctx.page.drawText(ctx.header.toUpperCase(), {
    x: MARGIN_X, y: PAGE_H - 35,
    size: 8, font: ctx.helvBold, color: C_SUBTLE,
  });
  // "MIRROR NYC" wordmark text top-right
  const mark = "MIRROR NYC";
  const markW = ctx.helvBold.widthOfTextAtSize(mark, 9);
  ctx.page.drawText(mark, {
    x: PAGE_W - MARGIN_X - markW, y: PAGE_H - 35,
    size: 9, font: ctx.helvBold, color: C_TEXT,
  });
  // Hairline under header
  ctx.page.drawLine({
    start: { x: MARGIN_X, y: PAGE_H - 45 },
    end: { x: PAGE_W - MARGIN_X, y: PAGE_H - 45 },
    thickness: 0.5, color: C_BORDER,
  });
  // Page number bottom-right
  const pn = String(ctx.pageNum).padStart(2, "0");
  ctx.page.drawText(pn, {
    x: PAGE_W - MARGIN_X - 10, y: 30,
    size: 8, font: ctx.helvBold, color: C_SUBTLE,
  });
}

/** Reserve `h` points on the current page; if not enough, page-break. */
export function ensureSpace(ctx: PacketCtx, h: number) {
  if (ctx.y - h < MARGIN_BOTTOM) {
    newContentPage(ctx);
  }
}

// ============================================================================
// Text wrapping
// ============================================================================
export function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const paragraphs = (text ?? "").replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  for (const para of paragraphs) {
    if (!para.trim()) { out.push(""); continue; }
    const words = para.split(/\s+/);
    let cur = "";
    for (const w of words) {
      const trial = cur ? `${cur} ${w}` : w;
      if (font.widthOfTextAtSize(trial, size) <= maxWidth) {
        cur = trial;
      } else {
        if (cur) out.push(cur);
        // Long single word — hard-truncate to maxWidth-ish.
        cur = w;
      }
    }
    if (cur) out.push(cur);
  }
  return out;
}

/** Draw multi-line wrapped paragraph; advances ctx.y. Returns new y. */
export function drawParagraph(
  ctx: PacketCtx,
  text: string,
  opts: { font?: PDFFont; size?: number; color?: ReturnType<typeof rgb>; maxWidth?: number; lineHeight?: number; x?: number } = {},
): number {
  const font = opts.font ?? ctx.helv;
  const size = opts.size ?? 10;
  const color = opts.color ?? C_TEXT;
  const maxWidth = opts.maxWidth ?? CONTENT_W;
  const lh = opts.lineHeight ?? size * 1.4;
  const x = opts.x ?? MARGIN_X;
  const lines = wrapText(text, font, size, maxWidth);
  for (const line of lines) {
    ensureSpace(ctx, lh);
    ctx.page.drawText(line, { x, y: ctx.y - size, size, font, color });
    ctx.y -= lh;
  }
  return ctx.y;
}

// ============================================================================
// Cover page (full-bleed black, white type, coral accent)
// ============================================================================
export function addCoverPage(ctx: PacketCtx, opts: {
  eyebrow: string;
  title: string;
  subtitleA: string;
  subtitleB: string;
  date: Date;
  stats: { label: string; value: string | number; accent?: "coral" | "success" | "warn" | "error" | "muted" }[];
  footer: string;
}) {
  // First page is auto-created in createPacketCtx; use it. If somehow we're
  // not on page 1, force a new page and draw cover treatment.
  if (ctx.pageNum !== 1 || ctx.doc.getPageCount() > 1) {
    ctx.page = ctx.doc.addPage([PAGE_W, PAGE_H]);
    ctx.pageNum += 1;
  }
  // Black bg
  ctx.page.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: C_BLACK });

  // Top-right "MIRROR NYC" mark
  const mark = "MIRROR NYC";
  const markW = ctx.helvBold.widthOfTextAtSize(mark, 9);
  ctx.page.drawText(mark, {
    x: PAGE_W - MARGIN_X - markW, y: PAGE_H - 50,
    size: 9, font: ctx.helvBold, color: C_WHITE,
  });

  // Top-left "Confidential" hint
  ctx.page.drawText("CONFIDENTIAL · INTERNAL HIRING REVIEW", {
    x: MARGIN_X, y: PAGE_H - 50,
    size: 8, font: ctx.helvBold, color: rgb(0.6, 0.6, 0.6),
  });

  // Center block
  const cx = PAGE_W / 2;
  let y = PAGE_H * 0.62;

  // Big "M" wordmark approximation: huge bold M
  const logoSize = 96;
  const logoW = ctx.helvBold.widthOfTextAtSize("M", logoSize);
  ctx.page.drawText("M", {
    x: cx - logoW / 2, y,
    size: logoSize, font: ctx.helvBold, color: C_WHITE,
  });
  // White underbar matching the brand mark
  ctx.page.drawRectangle({
    x: cx - logoW / 2, y: y - 12,
    width: logoW, height: 6, color: C_WHITE,
  });
  y -= 60;

  // Eyebrow (coral)
  const ebSize = 11;
  const ebW = ctx.helvBold.widthOfTextAtSize(opts.eyebrow.toUpperCase(), ebSize);
  ctx.page.drawText(opts.eyebrow.toUpperCase(), {
    x: cx - ebW / 2, y,
    size: ebSize, font: ctx.helvBold, color: C_CORAL,
  });
  y -= 28;

  // Title (huge white)
  const titleSize = 36;
  const title = opts.title.toUpperCase();
  const titleLines = wrapText(title, ctx.helvBold, titleSize, CONTENT_W);
  for (const line of titleLines) {
    const w = ctx.helvBold.widthOfTextAtSize(line, titleSize);
    ctx.page.drawText(line, {
      x: cx - w / 2, y,
      size: titleSize, font: ctx.helvBold, color: C_WHITE,
    });
    y -= titleSize * 1.05;
  }
  y -= 6;

  // Subtitle A + B (B in coral)
  const subSize = 18;
  const subAW = ctx.helvBold.widthOfTextAtSize(opts.subtitleA, subSize);
  ctx.page.drawText(opts.subtitleA, {
    x: cx - subAW / 2, y,
    size: subSize, font: ctx.helvBold, color: C_WHITE,
  });
  y -= 24;
  const subBW = ctx.helvBold.widthOfTextAtSize(opts.subtitleB, subSize);
  ctx.page.drawText(opts.subtitleB, {
    x: cx - subBW / 2, y,
    size: subSize, font: ctx.helvBold, color: C_CORAL,
  });
  y -= 30;

  // Date
  const dStr = fmtDateLong(opts.date).toUpperCase();
  const dW = ctx.helvBold.widthOfTextAtSize(dStr, 11);
  ctx.page.drawText(dStr, {
    x: cx - dW / 2, y,
    size: 11, font: ctx.helvBold, color: rgb(0.7, 0.7, 0.7),
  });
  y -= 18;

  // Coral rule
  ctx.page.drawRectangle({
    x: cx - 30, y: y - 6, width: 60, height: 2, color: C_CORAL,
  });
  y -= 30;

  // Stats grid (4 columns)
  const cols = opts.stats.length;
  const gap = 12;
  const totalW = Math.min(CONTENT_W, 460);
  const cellW = (totalW - gap * (cols - 1)) / cols;
  const cellH = 70;
  const startX = cx - totalW / 2;
  for (let i = 0; i < cols; i++) {
    const cx0 = startX + i * (cellW + gap);
    // Cell bg
    ctx.page.drawRectangle({
      x: cx0, y: y - cellH, width: cellW, height: cellH,
      color: rgb(0.078, 0.078, 0.078), // #141414
    });
    ctx.page.drawText(opts.stats[i].label.toUpperCase(), {
      x: cx0 + 12, y: y - 22,
      size: 8, font: ctx.helvBold, color: rgb(0.6, 0.6, 0.6),
    });
    const numColor = opts.stats[i].accent === "coral" ? C_CORAL
      : opts.stats[i].accent === "success" ? C_TIER3
      : opts.stats[i].accent === "warn" ? C_TIER2
      : opts.stats[i].accent === "error" ? C_TIER1
      : C_WHITE;
    ctx.page.drawText(String(opts.stats[i].value), {
      x: cx0 + 12, y: y - cellH + 14,
      size: 28, font: ctx.helvBold, color: numColor,
    });
  }
  y -= cellH + 40;

  // Bottom footer
  ctx.page.drawText(opts.footer, {
    x: MARGIN_X, y: 50,
    size: 8, font: ctx.helvBold, color: rgb(0.5, 0.5, 0.5),
  });
  const url = "MIRRORNYC.COM";
  const urlW = ctx.helvBold.widthOfTextAtSize(url, 8);
  ctx.page.drawText(url, {
    x: PAGE_W - MARGIN_X - urlW, y: 50,
    size: 8, font: ctx.helvBold, color: rgb(0.5, 0.5, 0.5),
  });
}

// ============================================================================
// Section headers / dividers on content pages
// ============================================================================
export function drawSectionTitle(ctx: PacketCtx, title: string, accent?: string) {
  ensureSpace(ctx, 38);
  ctx.page.drawText(title.toUpperCase(), {
    x: MARGIN_X, y: ctx.y - 22,
    size: 22, font: ctx.helvBold, color: C_TEXT,
  });
  if (accent) {
    const mainW = ctx.helvBold.widthOfTextAtSize(title.toUpperCase(), 22);
    ctx.page.drawText(" " + accent.toUpperCase(), {
      x: MARGIN_X + mainW, y: ctx.y - 22,
      size: 22, font: ctx.helvBold, color: C_CORAL,
    });
  }
  ctx.y -= 32;
}

export function drawSectionSub(ctx: PacketCtx, text: string) {
  drawParagraph(ctx, text, { size: 10, color: C_MUTED, maxWidth: CONTENT_W });
  ctx.y -= 8;
}

export function addSectionDivider(ctx: PacketCtx, opts: {
  title: string;        // "Candidate Packets"
  subtitle?: string;
  tag?: string;
}) {
  ctx.page = ctx.doc.addPage([PAGE_W, PAGE_H]);
  ctx.pageNum += 1;
  // Black bg
  ctx.page.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: C_BLACK });
  // Mirror mark
  const mark = "MIRROR NYC";
  const markW = ctx.helvBold.widthOfTextAtSize(mark, 9);
  ctx.page.drawText(mark, {
    x: PAGE_W - MARGIN_X - markW, y: PAGE_H - 50,
    size: 9, font: ctx.helvBold, color: C_WHITE,
  });
  // Title (large)
  let y = PAGE_H * 0.55;
  const titleLines = opts.title.toUpperCase().split("\n");
  for (const line of titleLines) {
    ctx.page.drawText(line, {
      x: MARGIN_X, y,
      size: 56, font: ctx.helvBold, color: C_WHITE,
    });
    y -= 60;
  }
  y -= 20;
  // Subtitle
  if (opts.subtitle) {
    const lines = wrapText(opts.subtitle, ctx.helv, 12, CONTENT_W * 0.7);
    for (const line of lines) {
      ctx.page.drawText(line, { x: MARGIN_X, y, size: 12, font: ctx.helv, color: C_CORAL });
      y -= 18;
    }
  }
  // Tag bottom-right
  if (opts.tag) {
    const tagW = ctx.helvBold.widthOfTextAtSize(opts.tag.toUpperCase(), 9);
    ctx.page.drawText(opts.tag.toUpperCase(), {
      x: PAGE_W - MARGIN_X - tagW, y: 50,
      size: 9, font: ctx.helvBold, color: C_CORAL,
    });
  }
  // Reset cursor for the next page (which will be added by next caller).
  ctx.y = PAGE_H - MARGIN_TOP;
}

// ============================================================================
// Tables
// ============================================================================
export type TableColumn = {
  label: string;
  width: number;       // points
  align?: "left" | "right" | "center";
  /** Optional formatter; otherwise stringify cell. */
};

export function drawTable(
  ctx: PacketCtx,
  cols: TableColumn[],
  rows: (string | { text: string; color?: ReturnType<typeof rgb>; bold?: boolean })[][],
) {
  // Header row
  const headerH = 22;
  ensureSpace(ctx, headerH);
  let x = MARGIN_X;
  // Header bg
  ctx.page.drawRectangle({
    x: MARGIN_X, y: ctx.y - headerH,
    width: cols.reduce((s, c) => s + c.width, 0), height: headerH,
    color: rgb(0.95, 0.95, 0.95),
  });
  for (const c of cols) {
    const tx = c.align === "right" ? x + c.width - 6 - ctx.helvBold.widthOfTextAtSize(c.label.toUpperCase(), 8)
      : c.align === "center" ? x + (c.width - ctx.helvBold.widthOfTextAtSize(c.label.toUpperCase(), 8)) / 2
      : x + 6;
    ctx.page.drawText(c.label.toUpperCase(), {
      x: tx, y: ctx.y - 14, size: 8, font: ctx.helvBold, color: C_TEXT,
    });
    x += c.width;
  }
  // Coral underline under header
  ctx.page.drawLine({
    start: { x: MARGIN_X, y: ctx.y - headerH },
    end: { x: MARGIN_X + cols.reduce((s, c) => s + c.width, 0), y: ctx.y - headerH },
    thickness: 1.5, color: C_CORAL,
  });
  ctx.y -= headerH + 2;

  // Body rows — each row may be one line tall; if a cell has long text, we
  // wrap and grow rowH.
  for (const row of rows) {
    // Compute row height by wrapping each cell.
    const cellLines: string[][] = [];
    let rowH = 14;
    for (let i = 0; i < cols.length; i++) {
      const cell = row[i];
      const text = typeof cell === "string" ? cell : cell?.text ?? "";
      const lines = wrapText(text, ctx.helv, 9, cols[i].width - 12);
      cellLines.push(lines);
      const h = Math.max(14, lines.length * 12 + 6);
      if (h > rowH) rowH = h;
    }
    ensureSpace(ctx, rowH);
    // Bottom border
    ctx.page.drawLine({
      start: { x: MARGIN_X, y: ctx.y - rowH },
      end: { x: MARGIN_X + cols.reduce((s, c) => s + c.width, 0), y: ctx.y - rowH },
      thickness: 0.4, color: C_BORDER,
    });
    let cx = MARGIN_X;
    for (let i = 0; i < cols.length; i++) {
      const cell = row[i];
      const text = typeof cell === "string" ? cell : cell?.text ?? "";
      const color = (typeof cell === "object" && cell?.color) || C_TEXT;
      const font = (typeof cell === "object" && cell?.bold) ? ctx.helvBold : ctx.helv;
      const lines = cellLines[i];
      const lh = 12;
      let lyOffset = 12;
      for (const line of lines) {
        const w = ctx.helv.widthOfTextAtSize(line, 9);
        const tx = cols[i].align === "right" ? cx + cols[i].width - 6 - w
          : cols[i].align === "center" ? cx + (cols[i].width - w) / 2
          : cx + 6;
        ctx.page.drawText(line, { x: tx, y: ctx.y - lyOffset, size: 9, font, color });
        lyOffset += lh;
      }
      cx += cols[i].width;
    }
    ctx.y -= rowH;
  }
  ctx.y -= 8;
}

// ============================================================================
// Writeup card (used by both packet types)
// ============================================================================
export function drawWriteupCard(ctx: PacketCtx, opts: {
  name: string;
  meta: string;       // "Rank #3 · Backup · Brooklyn, NY"
  scoreLine?: string; // "85" or "85 / 100"
  body: string;       // rationale / recruiter overview
  recruiterNote?: string | null;
  accent?: ReturnType<typeof rgb>;
}) {
  const padX = 14;
  const padY = 12;
  // Compute height by pre-wrapping body + note.
  const innerW = CONTENT_W - padX * 2 - 4; // -4 for left stripe
  const bodyLines = wrapText(opts.body, ctx.helv, 10, innerW);
  const noteLines = opts.recruiterNote
    ? wrapText(opts.recruiterNote, ctx.helv, 10, innerW)
    : [];
  const cardH = padY + 18 + 14
    + bodyLines.length * 14
    + (noteLines.length ? 16 + noteLines.length * 14 : 0)
    + padY;
  ensureSpace(ctx, cardH + 12);
  const top = ctx.y;
  // Card bg + border
  ctx.page.drawRectangle({
    x: MARGIN_X, y: top - cardH,
    width: CONTENT_W, height: cardH,
    color: rgb(0.97, 0.97, 0.97),
  });
  // Left accent stripe
  ctx.page.drawRectangle({
    x: MARGIN_X, y: top - cardH,
    width: 3, height: cardH,
    color: opts.accent ?? C_CORAL,
  });
  // Name (bold) + score on the right of header row
  const nameY = top - padY - 14;
  ctx.page.drawText(opts.name, {
    x: MARGIN_X + padX, y: nameY,
    size: 13, font: ctx.helvBold, color: C_TEXT,
  });
  if (opts.scoreLine) {
    const sw = ctx.helvBold.widthOfTextAtSize(opts.scoreLine, 12);
    ctx.page.drawText(opts.scoreLine, {
      x: MARGIN_X + CONTENT_W - padX - sw, y: nameY,
      size: 12, font: ctx.helvBold, color: C_CORAL,
    });
  }
  // Meta (muted)
  let cy = nameY - 14;
  ctx.page.drawText(opts.meta, {
    x: MARGIN_X + padX, y: cy,
    size: 8, font: ctx.helvBold, color: C_MUTED,
  });
  cy -= 14;
  // Body
  for (const line of bodyLines) {
    ctx.page.drawText(line, {
      x: MARGIN_X + padX, y: cy,
      size: 10, font: ctx.helv, color: C_TEXT,
    });
    cy -= 14;
  }
  // Recruiter note (with little label)
  if (noteLines.length) {
    cy -= 6;
    ctx.page.drawText("RECRUITER NOTE", {
      x: MARGIN_X + padX, y: cy,
      size: 8, font: ctx.helvBold, color: C_CORAL,
    });
    cy -= 12;
    for (const line of noteLines) {
      ctx.page.drawText(line, {
        x: MARGIN_X + padX, y: cy,
        size: 10, font: ctx.helv, color: C_TEXT,
      });
      cy -= 14;
    }
  }
  ctx.y = top - cardH - 12;
}

// ============================================================================
// Per-candidate title page + attachment merge (Storage-backed, HQ Phase 3.4)
// ============================================================================
export type StorageAttachment = {
  id: string;
  candidate_id: string;
  attachment_type: "resume" | "cover_letter" | "portfolio" | "email_pdf" | "other";
  file_name: string;
  file_path: string;
  file_size_bytes: number | null;
};

export type CandidatePageInput = {
  candidate: {
    id: string;
    name: string | null;
    email: string | null;
    applied_date: string | null;
    location?: string | null;
    portfolio_path_or_url?: string | null;
    detected_links?: { url: string; type: string }[] | null;
  };
  attachments: StorageAttachment[];
  rank: number;
  tier: string | null;
  tierLabel: string;
  totalScore: number | null;
  totalMax?: number;
  roleTitle: string;
  contextLine: string;
};

export function addCandidateTitlePage(ctx: PacketCtx, input: CandidatePageInput) {
  ctx.page = ctx.doc.addPage([PAGE_W, PAGE_H]);
  ctx.pageNum += 1;
  ctx.page.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: C_BLACK });
  // Mark
  const mark = "MIRROR NYC";
  const markW = ctx.helvBold.widthOfTextAtSize(mark, 9);
  ctx.page.drawText(mark, {
    x: PAGE_W - MARGIN_X - markW, y: PAGE_H - 50,
    size: 9, font: ctx.helvBold, color: C_WHITE,
  });
  // Rank tag
  let y = PAGE_H * 0.55;
  const accent = tierColor(input.tier);
  const rankLine = `RANK #${input.rank} · ${input.tierLabel.toUpperCase()}`;
  ctx.page.drawText(rankLine, {
    x: MARGIN_X, y,
    size: 11, font: ctx.helvBold, color: accent,
  });
  y -= 30;
  // Name (huge)
  const name = (input.candidate.name ?? input.candidate.email ?? "Candidate").toUpperCase();
  const nameSize = 48;
  const nameLines = wrapText(name, ctx.helvBold, nameSize, CONTENT_W);
  for (const line of nameLines) {
    ctx.page.drawText(line, {
      x: MARGIN_X, y,
      size: nameSize, font: ctx.helvBold, color: C_WHITE,
    });
    y -= nameSize * 1.05;
  }
  y -= 8;
  // Score
  if (input.totalScore != null) {
    const scoreText = input.totalMax ? `${input.totalScore} / ${input.totalMax}` : String(input.totalScore);
    ctx.page.drawText(scoreText, {
      x: MARGIN_X, y,
      size: 28, font: ctx.helvBold, color: C_CORAL,
    });
    y -= 32;
  }
  // Coral rule
  ctx.page.drawRectangle({
    x: MARGIN_X, y: y - 4, width: 60, height: 2, color: C_CORAL,
  });
  y -= 18;
  // Role + context
  ctx.page.drawText(`${input.roleTitle} · ${input.contextLine}`, {
    x: MARGIN_X, y,
    size: 11, font: ctx.helv, color: rgb(0.7, 0.7, 0.7),
  });

  // Materials list at bottom
  let my = 240;
  ctx.page.drawText("SUBMITTED MATERIALS", {
    x: MARGIN_X, y: my,
    size: 10, font: ctx.helvBold, color: C_CORAL,
  });
  my -= 18;

  const docs: { label: string; reason?: string; missing?: boolean }[] = [];
  const atts = input.attachments;
  const detected = input.candidate.detected_links ?? [];
  const resumeAtt = atts.find((a) => a.attachment_type === "resume" || /resume|cv/i.test(a.file_name));
  const coverAtt = atts.find((a) => a.attachment_type === "cover_letter" || /cover/i.test(a.file_name));
  const otherAtts = atts.filter((a) => a !== resumeAtt && a !== coverAtt);

  if (resumeAtt) docs.push({ label: "Resume", reason: resumeAtt.file_name });
  else docs.push({ label: "Resume", reason: "(not submitted)", missing: true });
  if (coverAtt) docs.push({ label: "Cover Letter", reason: coverAtt.file_name });
  else docs.push({ label: "Cover Letter", reason: "(not submitted)", missing: true });
  for (const a of otherAtts) docs.push({ label: a.file_name, reason: a.attachment_type });
  for (const u of detected) {
    const t = u.type === "portfolio_site" ? "Portfolio Link"
      : u.type === "vimeo_reel" ? "Vimeo Reel"
      : u.type === "drive_folder" ? "Drive Folder"
      : "Link";
    docs.push({ label: t, reason: u.url });
  }

  for (const d of docs) {
    if (my < 60) break; // out of room — page limited; we don't paginate the title page
    // Coral dot (or muted dot if missing)
    ctx.page.drawCircle({
      x: MARGIN_X + 4, y: my + 4,
      size: 3, color: d.missing ? rgb(0.4, 0.4, 0.4) : C_CORAL,
    });
    ctx.page.drawText(d.label, {
      x: MARGIN_X + 16, y: my,
      size: 11, font: ctx.helvBold, color: d.missing ? rgb(0.5, 0.5, 0.5) : C_WHITE,
    });
    if (d.reason) {
      const reasonText = d.reason.length > 60 ? d.reason.slice(0, 60) + "…" : d.reason;
      const rW = ctx.helv.widthOfTextAtSize(reasonText, 9);
      ctx.page.drawText(reasonText, {
        x: PAGE_W - MARGIN_X - rW, y: my,
        size: 9, font: ctx.helv, color: rgb(0.6, 0.6, 0.6),
      });
    }
    my -= 18;
  }
  // Reset cursor for next-after-title content (ensures any further calls
  // start a fresh content page).
  ctx.y = MARGIN_BOTTOM - 1;
}

// ============================================================================
// Storage attachment fetcher + PDF-only attachment merge.
// DOCX is no longer converted (Phase 3.6.1 — CloudConvert removed); it gets
// listed by filename on the title page but not embedded.
// ============================================================================
// deno-lint-ignore no-explicit-any
export async function fetchStorageAttachment(supabase: any, attachment: StorageAttachment): Promise<Uint8Array | null> {
  try {
    const { data, error } = await supabase.storage
      .from("candidate_attachments")
      .download(attachment.file_path);
    if (error) {
      console.error(`[packetRender] Storage download failed for ${attachment.file_name}:`, error);
      return null;
    }
    const buf = await (data as Blob).arrayBuffer();
    return new Uint8Array(buf);
  } catch (e) {
    console.error(`[packetRender] Storage download exception for ${attachment.file_name}:`, e);
    return null;
  }
}

/** Merge each candidate's PDF attachments (resume/cover letter/etc.) into doc.
    Non-PDF (DOCX/etc.) attachments are skipped — listed on title page only.
    NO size cap: design portfolios can be 10-25MB+ and must ship intact.
    The email path was already moved off PDF-as-base64-attachment to a
    signed-URL link in 3.6.2, so the only remaining memory concern is
    pdf-lib's in-memory document. We process attachments one at a time
    and let GC reclaim the source bytes between each. If a packet still
    OOMs on a degenerate case, the 7-day download URL is still valid; the
    user just won't get the auto-merged PDF for that run. */
// deno-lint-ignore no-explicit-any
export async function mergePdfAttachments(doc: PDFDocument, supabase: any, attachments: StorageAttachment[]) {
  // Order: cover, resume, others (so the hiring manager reads them in order)
  const resume = attachments.find((a) => a.attachment_type === "resume" || /resume|cv/i.test(a.file_name));
  const cover = attachments.find((a) => a.attachment_type === "cover_letter" || /cover/i.test(a.file_name));
  const others = attachments.filter((a) => a !== resume && a !== cover);
  const ordered = [cover, resume, ...others].filter(Boolean) as StorageAttachment[];

  for (const att of ordered) {
    const isPdf = /\.pdf$/i.test(att.file_name);
    if (!isPdf) {
      console.log(`[packetRender] Skipping non-PDF ${att.file_name}`);
      continue;
    }
    let bytes = await fetchStorageAttachment(supabase, att);
    if (!bytes) continue;
    const header = new TextDecoder().decode(bytes.slice(0, 8));
    if (!header.startsWith("%PDF-")) {
      console.warn(`[packetRender] ${att.file_name} missing %PDF- header; skipping`);
      continue;
    }
    try {
      const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
      const pages = await doc.copyPages(src, src.getPageIndices());
      pages.forEach((p) => doc.addPage(p));
      console.log(`[packetRender] Embedded ${pages.length} pages from ${att.file_name} (${bytes.length} bytes)`);
    } catch (e) {
      console.error(`[packetRender] pdf-lib merge failed for ${att.file_name}:`, e);
    }
    // Drop reference so GC can reclaim the source bytes before next iter.
    bytes = null as unknown as Uint8Array;
  }
}

// ============================================================================
// Final assembly: upload merged PDF → packets bucket → signed URL.
// ============================================================================
export async function uploadPacketAndSign(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  doc: PDFDocument,
  opts: {
    pathPrefix: string;
    roleSlug: string;
    friendlyKind: string;
    safeKind: string;
  },
): Promise<{ path: string; signedUrl: string; emailUrl: string; bytes: number; friendlyName: string }> {
  const out = await doc.save();
  const generatedAt = new Date();
  const dateStr = generatedAt.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  const isoDate = generatedAt.toISOString().slice(0, 10);
  const friendlyName = `Mirror · ${opts.friendlyKind} · ${dateStr}.pdf`;
  const safeName = `mirror-${opts.roleSlug}-${opts.safeKind}-${isoDate}.pdf`;
  const path = `${opts.pathPrefix}/${Date.now()}/${safeName}`;

  const { error: upErr } = await supabase.storage.from("packets").upload(path, out, {
    contentType: "application/pdf", upsert: true,
  });
  if (upErr) throw upErr;
  // Two signed URLs: a 1-hour browser-download URL for the immediate
  // window.open() in the user's tab, and a 7-day URL embedded in the
  // hiring-manager email so the link doesn't expire before they get to it.
  const [{ data: signedShort, error: signErr }, { data: signedLong }] = await Promise.all([
    supabase.storage.from("packets").createSignedUrl(path, 3600, { download: friendlyName }),
    supabase.storage.from("packets").createSignedUrl(path, 7 * 24 * 3600, { download: friendlyName }),
  ]);
  if (signErr) throw signErr;

  return {
    path,
    signedUrl: signedShort?.signedUrl ?? "",
    emailUrl: signedLong?.signedUrl ?? signedShort?.signedUrl ?? "",
    bytes: out.byteLength,
    friendlyName,
  };
}

// ============================================================================
// Email packet to hiring manager via Gmail service account (gmail.send scope).
//
// Phase 3.6.2: switched from "attachment via base64 MIME" to "signed-URL link"
// to stay inside Supabase Edge's 256MB memory ceiling. Base64-encoding a
// large PDF inside the function was the WORKER_RESOURCE_LIMIT culprit on
// big-resume packets. The hiring manager now gets a 7-day signed link.
// ============================================================================
function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}
function base64Url(s: string): string {
  return s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function buildLinkMime(opts: { to: string; from: string; subject: string; bodyText: string }): string {
  return [
    `From: ${opts.from}`,
    `To: ${opts.to}`,
    `Subject: ${opts.subject}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 7bit",
    "",
    opts.bodyText,
  ].join("\r\n");
}

export async function sendPacketEmail(opts: {
  to: string;
  subject: string;
  bodyText: string;
  /** 7-day signed download URL for the packet. Inserted into the email body. */
  packetUrl: string;
  /** Optional friendly filename hint shown in the body. */
  attachmentFilename?: string;
}): Promise<boolean> {
  if (!opts.to) {
    console.warn("[packetRender] sendPacketEmail: no recipient, skipping");
    return false;
  }
  try {
    const token = await getGmailAccessToken();
    const fullBody = `${opts.bodyText}\n\nDownload: ${opts.packetUrl}\n\nThis link expires in 7 days. Save the PDF locally for long-term reference.`;
    const mime = buildLinkMime({
      to: opts.to,
      from: "Mirror NYC <jobs@mirrornyc.com>",
      subject: opts.subject,
      bodyText: fullBody,
    });
    const raw = base64Url(bytesToBase64(new TextEncoder().encode(mime)));
    const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ raw }),
    });
    if (!res.ok) {
      const errText = await res.text();
      console.error(`[packetRender] Gmail send failed (${res.status}):`, errText.slice(0, 400));
      return false;
    }
    console.log(`[packetRender] Packet link emailed to ${opts.to}`);
    return true;
  } catch (e) {
    console.error("[packetRender] sendPacketEmail exception:", e);
    return false;
  }
}
