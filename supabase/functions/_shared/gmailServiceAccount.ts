// Gmail-scoped service-account access token wrapper.
//
// Phase 4.8.1-port: refactored to delegate to googleServiceAccount.ts.
// Public API (getGmailAccessToken) preserved; existing callers unchanged:
//   - ts-pull-candidates       (Gmail message ingestion)
//   - ts-evaluate-candidate    (Gmail message ingestion for re-eval)
//   - _shared/sendEmail.ts     (gmail.send for general transactional email)
//   - _shared/packetRender.ts  (gmail.send for packet attachments / links)
//
// Both readonly + send scopes are delegated to the service account in the
// Mirror NYC Workspace Admin Console (see docs/auth-model.md § Service
// account). Impersonates jobs@mirrornyc.com so messages.list / messages.send
// run as the user.
//
// Module-level token cache lives inside googleServiceAccount.ts, keyed by
// `${impersonateUser ?? ""}|${sortedScopes}`. A long pull still re-uses the
// same in-process token across calls.

import { getGoogleAccessToken } from "./googleServiceAccount.ts";

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
];
const IMPERSONATE_USER = "jobs@mirrornyc.com";

/**
 * Get a Gmail OAuth2 access token impersonating jobs@mirrornyc.com.
 * Caches the token until ~5 minutes before its expiry (cache lives in
 * googleServiceAccount.ts).
 */
export async function getGmailAccessToken(): Promise<string> {
  return getGoogleAccessToken(SCOPES, { impersonateUser: IMPERSONATE_USER });
}
