// Service-account auth helper for Google Workspace APIs (Gmail, Drive,
// Slides). Reads GOOGLE_SERVICE_ACCOUNT_KEY from Supabase secrets, builds
// an RS256-signed JWT, exchanges it for an OAuth2 access token via the
// JWT bearer flow.
//
// Two call sites:
//   1. Gmail (gmailServiceAccount.ts) impersonates jobs@mirrornyc.com
//      (`sub` claim) so messages.list / messages.send run as the user.
//   2. Drive + Slides (vs-generate-deck, lands in 4.8.2-port) does NOT
//      impersonate. Decks land in a Mirror Shared Drive that the service
//      account is a member of, so the service account itself owns the
//      API calls.
//
// Both flows want their own access token (different scope set), so the
// module-level cache keys by `${impersonateUser ?? ""}|${sortedScopes}`.
//
// Phase 4.8.1-port: cherry-picked from failed-attempt main commit
// be30168. The Gmail wrapper still exists; it just delegates here.

const TOKEN_URL = "https://oauth2.googleapis.com/token";

type ServiceAccountKey = {
  client_email: string;
  private_key: string;
  token_uri?: string;
};

type CachedToken = { value: string; expiresAt: number };

const cache = new Map<string, CachedToken>();

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

async function signJwt(
  key: ServiceAccountKey,
  scopes: string[],
  impersonateUser: string | undefined,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload: Record<string, unknown> = {
    iss: key.client_email,
    scope: scopes.join(" "),
    aud: key.token_uri ?? TOKEN_URL,
    iat: now,
    exp: now + 3600,
  };
  if (impersonateUser) payload.sub = impersonateUser;

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

export type GetGoogleAccessTokenOptions = {
  /**
   * Workspace user to impersonate via domain-wide delegation. Required for
   * Gmail (the service account itself can't read user mail). Leave undefined
   * for Drive/Slides when the service account owns the API call directly.
   */
  impersonateUser?: string;
};

/**
 * Fetch a Google OAuth2 access token via the JWT bearer flow.
 *
 * @param scopes - One or more `https://www.googleapis.com/auth/*` scopes.
 * @param options - `impersonateUser` for domain-wide-delegation flows.
 */
export async function getGoogleAccessToken(
  scopes: string[],
  options: GetGoogleAccessTokenOptions = {},
): Promise<string> {
  if (!scopes.length) {
    throw new Error("getGoogleAccessToken: at least one scope is required.");
  }
  const impersonateUser = options.impersonateUser;
  const cacheKey = `${impersonateUser ?? ""}|${[...scopes].sort().join(" ")}`;

  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 5 * 60_000) {
    return cached.value;
  }

  const key = loadServiceAccountKey();
  const jwt = await signJwt(key, scopes, impersonateUser);
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
    throw new Error(
      `Google token exchange failed (${res.status}): ${errText.slice(0, 300)}`,
    );
  }
  const data = (await res.json()) as { access_token: string; expires_in: number };
  const expiresAt = Date.now() + (data.expires_in ?? 3600) * 1000;
  cache.set(cacheKey, { value: data.access_token, expiresAt });
  return data.access_token;
}
