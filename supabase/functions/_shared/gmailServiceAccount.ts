// Service-account-based Gmail auth. Reads the GOOGLE_SERVICE_ACCOUNT_KEY
// secret (the JSON contents of the SA key), builds a JWT impersonating
// jobs@mirrornyc.com with the gmail.readonly scope, and exchanges it for an
// access token via OAuth2 STS.
//
// Mirrors scripts/verify-service-account.ts logic but reads the key from env
// instead of disk (Edge Functions have no filesystem access).
//
// Token expiry is honored: same JWT is reused inside its 1-hour TTL via a
// module-level cache so a long pull doesn't re-mint per call.

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const IMPERSONATE_USER = "jobs@mirrornyc.com";
const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
];

type ServiceAccountKey = {
  client_email: string;
  private_key: string;
  token_uri?: string;
};

let cachedToken: { value: string; expiresAt: number } | null = null;

function loadServiceAccountKey(): ServiceAccountKey {
  const raw = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_KEY");
  if (!raw) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY is not set in Supabase secrets.");
  }
  let parsed: ServiceAccountKey;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(
      `GOOGLE_SERVICE_ACCOUNT_KEY is not valid JSON: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY is missing client_email or private_key.");
  }
  return parsed;
}

// Convert the PEM private key into a CryptoKey for signing.
async function importRsaPrivateKey(pem: string): Promise<CryptoKey> {
  const stripped = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s/g, "");
  const der = Uint8Array.from(atob(stripped), (c) => c.charCodeAt(0));
  return await crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

function base64UrlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlEncodeJson(obj: unknown): string {
  return base64UrlEncode(new TextEncoder().encode(JSON.stringify(obj)));
}

async function signJwt(key: ServiceAccountKey): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: key.client_email,
    sub: IMPERSONATE_USER,
    scope: SCOPES.join(" "),
    aud: key.token_uri ?? TOKEN_URL,
    iat: now,
    exp: now + 3600,
  };
  const headerB64 = base64UrlEncodeJson(header);
  const payloadB64 = base64UrlEncodeJson(payload);
  const signingInput = `${headerB64}.${payloadB64}`;
  const cryptoKey = await importRsaPrivateKey(key.private_key);
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(signingInput),
  );
  const sigB64 = base64UrlEncode(new Uint8Array(sig));
  return `${signingInput}.${sigB64}`;
}

/**
 * Get a Gmail OAuth2 access token impersonating jobs@mirrornyc.com.
 * Caches the token until ~5 minutes before its expiry.
 */
export async function getGmailAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 5 * 60_000) {
    return cachedToken.value;
  }
  const key = loadServiceAccountKey();
  const jwt = await signJwt(key);
  const tokenUri = key.token_uri ?? TOKEN_URL;
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion: jwt,
  });
  const res = await fetch(tokenUri, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gmail token exchange failed (${res.status}): ${errText.slice(0, 300)}`);
  }
  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    value: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  };
  return data.access_token;
}
