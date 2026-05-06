/**
 * Verify Google service account + domain-wide delegation for Mirror NYC HQ.
 *
 * Loads a service account JSON key from the path in $SERVICE_ACCOUNT_KEY_PATH,
 * authenticates with subject impersonation to jobs@mirrornyc.com, and lists
 * a single Gmail message. Success means delegation is properly granted.
 *
 * Usage:
 *   SERVICE_ACCOUNT_KEY_PATH=~/secrets/mirror-sa-key.json \
 *     npx tsx scripts/verify-service-account.ts
 *
 * Most common failure: HTTP 403 with "unauthorized_client". That means the
 * service account exists and the key is valid, but a Workspace admin has not
 * granted domain-wide delegation for the gmail.readonly scope. Fix is in
 * Google Workspace Admin Console -> Security -> API Controls -> Domain-wide
 * Delegation. Add the service account's client ID with scope:
 *   https://www.googleapis.com/auth/gmail.readonly
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { google } from "googleapis";

const IMPERSONATE_USER = "jobs@mirrornyc.com";
const SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"];

function expandHome(p: string): string {
  if (p.startsWith("~/")) return resolve(homedir(), p.slice(2));
  return resolve(p);
}

async function main() {
  const keyPathRaw = process.env.SERVICE_ACCOUNT_KEY_PATH;
  if (!keyPathRaw) {
    console.error("SERVICE_ACCOUNT_KEY_PATH is not set.");
    console.error("Example: SERVICE_ACCOUNT_KEY_PATH=~/secrets/mirror-sa-key.json npx tsx scripts/verify-service-account.ts");
    process.exit(1);
  }

  const keyPath = expandHome(keyPathRaw);
  if (!existsSync(keyPath)) {
    console.error(`Key file not found at: ${keyPath}`);
    process.exit(1);
  }

  let key: { client_email?: string; private_key?: string };
  try {
    key = JSON.parse(readFileSync(keyPath, "utf8"));
  } catch (err) {
    console.error(`Failed to parse JSON key at ${keyPath}:`, err);
    process.exit(1);
  }

  if (!key.client_email || !key.private_key) {
    console.error("Key file is missing client_email or private_key. Make sure this is a service account JSON key, not an OAuth client secret.");
    process.exit(1);
  }

  console.log(`Service account: ${key.client_email}`);
  console.log(`Impersonating:   ${IMPERSONATE_USER}`);
  console.log(`Scopes:          ${SCOPES.join(", ")}`);
  console.log("");

  const jwt = new google.auth.JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: SCOPES,
    subject: IMPERSONATE_USER,
  });

  try {
    await jwt.authorize();
  } catch (err) {
    console.error("Authorization failed.");
    console.error(err);
    process.exit(1);
  }

  const gmail = google.gmail({ version: "v1", auth: jwt });

  try {
    const list = await gmail.users.messages.list({ userId: "me", maxResults: 1 });
    const messages = list.data.messages ?? [];

    if (messages.length === 0) {
      console.log("Domain-wide delegation working.");
      console.log("(jobs@mirrornyc.com inbox has no messages, so no snippet to show.)");
      return;
    }

    const msgId = messages[0].id!;
    const detail = await gmail.users.messages.get({
      userId: "me",
      id: msgId,
      format: "METADATA",
      metadataHeaders: ["Subject", "From", "Date"],
    });

    const headers = detail.data.payload?.headers ?? [];
    const headerVal = (n: string) => headers.find((h) => h.name?.toLowerCase() === n.toLowerCase())?.value ?? "";

    console.log("Domain-wide delegation working.");
    console.log("");
    console.log(`Latest message (id ${msgId}):`);
    console.log(`  From:    ${headerVal("From")}`);
    console.log(`  Subject: ${headerVal("Subject")}`);
    console.log(`  Date:    ${headerVal("Date")}`);
    console.log(`  Snippet: ${detail.data.snippet ?? ""}`);
  } catch (err) {
    const e = err as { code?: number; response?: { status?: number; data?: unknown }; message?: string };
    console.error("Gmail API call failed.");
    if (e.response?.status === 403) {
      console.error("");
      console.error("HTTP 403 most often means domain-wide delegation is not granted yet.");
      console.error("Have a Mirror NYC Workspace admin add this service account's client ID");
      console.error(`with scope: ${SCOPES.join(", ")}`);
      console.error("via Admin Console -> Security -> API Controls -> Domain-wide Delegation.");
      console.error("");
    }
    console.error("Full error response:");
    console.error(JSON.stringify(e.response?.data ?? e.message ?? e, null, 2));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
