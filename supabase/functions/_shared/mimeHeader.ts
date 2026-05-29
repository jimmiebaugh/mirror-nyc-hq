// Strip MIME control chars (CR / LF / NUL) from a header value so a poisoned
// To / Subject / From can't inject extra MIME headers (BCC smuggling, etc.).
// Promoted to _shared in Phase 6.0 (F019) so buildMime (sendEmail.ts) and
// buildLinkMime (packetRender.ts) sanitize by default rather than trusting
// each caller. Mirrors the local stripMimeControl in
// notify-admin-of-pending-user / notifications-dispatch (which sanitize their
// own body values at the call site).
export function stripMimeControl(s: string): string {
  return s.replace(/[\r\n\0]/g, "");
}
