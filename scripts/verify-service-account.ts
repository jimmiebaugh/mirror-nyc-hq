/**
 * Verify Google service account + domain-wide delegation for Mirror NYC HQ.
 *
 * Loads a service account JSON key from $SERVICE_ACCOUNT_KEY_PATH, then for
 * each scope Mirror NYC HQ uses, requests a token via JWT bearer flow with
 * subject impersonation to jobs@mirrornyc.com. A successful token grant
 * proves the scope is delegated. Where a non-destructive API call exists,
 * the script also exercises it for additional proof.
 *
 * Scopes checked:
 *   - gmail.readonly  (Talent Scout candidate ingestion)
 *   - gmail.send      (outbound email from jobs@mirrornyc.com)
 *   - drive           (Drive saves and template reads)
 *   - presentations   (Slides deck generation)
 *
 * Usage:
 *   SERVICE_ACCOUNT_KEY_PATH=~/.config/mirror-nyc-hq/mirror-sa-key.json \
 *     npx tsx scripts/verify-service-account.ts
 *
 * Most common failure: HTTP 403 / `unauthorized_client` on token request.
 * That means a Workspace admin hasn't granted domain-wide delegation for
 * that scope yet. Fix in Admin Console -> Security -> API Controls ->
 * Domain-wide Delegation. Add the service account's client ID and include
 * every scope from above in the comma-separated scopes field.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { google } from "googleapis";

const IMPERSONATE_USER = "jobs@mirrornyc.com";

type ScopeCheck = {
  label: string;
  scope: string;
  /** Optional non-destructive smoke call. Returns a one-line proof string. */
  smoke?: (auth: InstanceType<typeof google.auth.JWT>) => Promise<string>;
};

const CHECKS: ScopeCheck[] = [
  {
    label: "gmail.readonly",
    scope: "https://www.googleapis.com/auth/gmail.readonly",
    smoke: async (auth) => {
      const gmail = google.gmail({ version: "v1", auth });
      const list = await gmail.users.messages.list({ userId: "me", maxResults: 1 });
      const count = list.data.resultSizeEstimate ?? (list.data.messages?.length ?? 0);
      return `messages.list ok (resultSizeEstimate ~ ${count})`;
    },
  },
  {
    label: "gmail.send",
    scope: "https://www.googleapis.com/auth/gmail.send",
    // No non-destructive call uses this scope alone. JWT auth + Workspace
    // admin showing the scope in the DWD grant is the proof.
  },
  {
    label: "drive",
    scope: "https://www.googleapis.com/auth/drive",
    smoke: async (auth) => {
      const drive = google.drive({ version: "v3", auth });
      const list = await drive.files.list({ pageSize: 1, fields: "files(id,name)" });
      const sample = list.data.files?.[0];
      return sample ? `files.list ok (sample: ${sample.name})` : "files.list ok (drive empty)";
    },
  },
  {
    label: "presentations",
    scope: "https://www.googleapis.com/auth/presentations",
    // Slides API has no list endpoint and only destructive create/batchUpdate.
    // JWT auth is the proof; functional confirmation comes the first time
    // vs-generate-deck runs in Phase 4.
  },
];

function expandHome(p: string): string {
  if (p.startsWith("~/")) return resolve(homedir(), p.slice(2));
  return resolve(p);
}

function loadKey(): { client_email: string; private_key: string } {
  const keyPathRaw = process.env.SERVICE_ACCOUNT_KEY_PATH;
  if (!keyPathRaw) {
    console.error("SERVICE_ACCOUNT_KEY_PATH is not set.");
    console.error("Example: SERVICE_ACCOUNT_KEY_PATH=~/.config/mirror-nyc-hq/mirror-sa-key.json npx tsx scripts/verify-service-account.ts");
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

  return { client_email: key.client_email, private_key: key.private_key };
}

type CheckResult = {
  label: string;
  scope: string;
  pass: boolean;
  proof?: string;
  reason?: string;
};

async function runCheck(
  key: { client_email: string; private_key: string },
  check: ScopeCheck,
): Promise<CheckResult> {
  const jwt = new google.auth.JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: [check.scope],
    subject: IMPERSONATE_USER,
  });

  try {
    await jwt.authorize();
  } catch (err) {
    const e = err as { response?: { data?: { error?: string; error_description?: string } }; message?: string };
    const oauthError = e.response?.data?.error;
    const desc = e.response?.data?.error_description;
    return {
      label: check.label,
      scope: check.scope,
      pass: false,
      reason: oauthError ? `${oauthError}${desc ? `: ${desc}` : ""}` : (e.message ?? "authorize failed"),
    };
  }

  if (!check.smoke) {
    return {
      label: check.label,
      scope: check.scope,
      pass: true,
      proof: "token granted (no read-only API to smoke-test)",
    };
  }

  try {
    const proof = await check.smoke(jwt);
    return { label: check.label, scope: check.scope, pass: true, proof };
  } catch (err) {
    const e = err as { code?: number; response?: { status?: number; data?: unknown }; message?: string };
    const status = e.response?.status ?? e.code;
    const body = JSON.stringify(e.response?.data ?? e.message ?? e);
    return {
      label: check.label,
      scope: check.scope,
      pass: false,
      reason: `API call failed (status ${status}): ${body}`,
    };
  }
}

async function main() {
  const key = loadKey();

  console.log(`Service account: ${key.client_email}`);
  console.log(`Impersonating:   ${IMPERSONATE_USER}`);
  console.log(`Scopes to check: ${CHECKS.length}`);
  console.log("");

  const results: CheckResult[] = [];
  for (const check of CHECKS) {
    process.stdout.write(`[ ... ] ${check.label.padEnd(16)} `);
    const result = await runCheck(key, check);
    results.push(result);
    const tag = result.pass ? "PASS" : "FAIL";
    process.stdout.write(`\r[ ${tag} ] ${result.label.padEnd(16)} ${result.proof ?? result.reason}\n`);
  }

  console.log("");
  const failed = results.filter((r) => !r.pass);
  if (failed.length === 0) {
    console.log(`All ${results.length} scopes delegated. Domain-wide delegation fully configured.`);
    return;
  }

  console.log(`${failed.length} of ${results.length} scopes failed:`);
  for (const r of failed) {
    console.log(`  - ${r.label} (${r.scope})`);
    console.log(`    ${r.reason}`);
  }
  console.log("");
  console.log("Fix in Workspace Admin Console -> Security -> API Controls -> Domain-wide Delegation.");
  console.log("Edit the service account's client ID entry and add the missing scopes (comma-separated):");
  console.log(`  ${failed.map((r) => r.scope).join(",")}`);
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
