// Mirror M wordmark, embedded as SVG path data so packetRender can draw it
// directly via pdf-lib's drawSvgPath (no binary asset, no base64 bloat,
// vector quality at any size, self-contained in the function bundle so it
// can never go missing again).
//
// Source: ~/Documents/Claude/Projects/Venue Sourcing App/wireframe/Mirror Logo.svg
// Original SVG viewBox: 0 0 1911.95 2807.3 (W x H, aspect 0.681).
// Two paths: the M body and the underbar.
//
// Phase 3.6.16. Replaces the prior Helvetica-"M" + white-rectangle
// approximation in addCoverPage and the lost PNG-base64 attempt.

import { PDFPage, rgb } from "https://esm.sh/pdf-lib@1.17.1";

export const MIRROR_LOGO_VIEWBOX_W = 1911.95;
export const MIRROR_LOGO_VIEWBOX_H = 2807.3;
export const MIRROR_LOGO_ASPECT = MIRROR_LOGO_VIEWBOX_W / MIRROR_LOGO_VIEWBOX_H; // ~0.681

// The M body (top portion of the wordmark).
const MIRROR_LOGO_PATH_M =
  "M26.23,0h302.82c9.15,0,17.64,4.77,22.4,12.58l580.92,953.79c10.17,16.7,34.38,16.8,44.68.18L1569.03,12.4c4.78-7.71,13.21-12.4,22.29-12.4h294.4c14.48,0,26.23,11.74,26.23,26.23v2041.24c0,14.48-11.74,26.23-26.23,26.23h-248.7c-14.48,0-26.23-11.74-26.23-26.23V474.4h-5.65l-540.58,865.5c-4.79,7.67-13.2,12.33-22.24,12.33h-178.38c-9.02,0-17.41-4.64-22.21-12.27L306.8,488.61h-5.65v1578.86c0,14.48-11.74,26.23-26.23,26.23H26.23c-14.48,0-26.23-11.74-26.23-26.23V26.23C0,11.74,11.74,0,26.23,0Z";

// The underbar (rounded rectangle below the M).
const MIRROR_LOGO_PATH_UNDERBAR =
  "M0,2781.07v-260.16c0-14.48,11.74-26.23,26.23-26.23h1859.49c14.48,0,26.23,11.74,26.23,26.23v260.16c0,14.48-11.74,26.23-26.23,26.23H26.23c-14.48,0-26.23-11.74-26.23-26.23Z";

/**
 * Draw the Mirror M wordmark on a PDF page. Renders both SVG paths (M body
 * + underbar) at the brand-canonical aspect ratio, scaled so the rendered
 * height equals `opts.height`.
 *
 * `topY` is the PDF y-coordinate of the TOP edge of the logo. pdf-lib's
 * drawSvgPath places the SVG (0,0) origin at the (x, y) you pass; since
 * SVG y grows downward and pdf-lib flips it for PDF, that origin point
 * corresponds to the visual top of the path. The bottom edge ends up at
 * topY - opts.height in PDF coordinates.
 */
export function drawMirrorLogo(
  page: PDFPage,
  opts: { x: number; topY: number; height: number; color: ReturnType<typeof rgb> },
): { width: number } {
  const scale = opts.height / MIRROR_LOGO_VIEWBOX_H;
  const width = opts.height * MIRROR_LOGO_ASPECT;
  page.drawSvgPath(MIRROR_LOGO_PATH_M, {
    x: opts.x, y: opts.topY, scale, color: opts.color,
  });
  page.drawSvgPath(MIRROR_LOGO_PATH_UNDERBAR, {
    x: opts.x, y: opts.topY, scale, color: opts.color,
  });
  return { width };
}
