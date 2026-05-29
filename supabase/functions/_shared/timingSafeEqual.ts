// Constant-time string comparison for secret material (HMACs, shared
// secrets, service-role keys). Use anywhere two strings have to be
// compared as proof-of-possession; the regular `===` operator leaks the
// length of the matching prefix via early-return timing.
//
// Strategy:
//   1. If both inputs decode to byte sequences of the same length and the
//      runtime exposes a native constant-time comparator (Deno 1.36+
//      ships `crypto.timingSafeEqual` via `@std/crypto/timing-safe-equal`,
//      or the global Web Crypto on newer runtimes), use it.
//   2. Otherwise fall back to a length-independent XOR loop that walks
//      both byte arrays in full and accumulates differences. The loop
//      always runs `max(lenA, lenB)` iterations so the work per call is
//      bounded by the longer input, not the matching prefix.
//
// Returns false on length mismatch (already-leaked information; nothing
// the comparator can do).
export async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const bytesA = encoder.encode(a);
  const bytesB = encoder.encode(b);

  if (bytesA.length !== bytesB.length) return false;

  // Try the native Deno API first (sync, fast, constant-time).
  // `crypto.timingSafeEqual` is a Deno/Node extension not present on the
  // standard Web Crypto `Crypto` lib type, so reach for it via an unknown-
  // typed view of the global rather than the typed `crypto` binding.
  const maybeCrypto = (globalThis as { crypto?: unknown }).crypto;
  const nativeFn =
    maybeCrypto && typeof maybeCrypto === "object"
      ? (maybeCrypto as { timingSafeEqual?: unknown }).timingSafeEqual
      : undefined;
  if (typeof nativeFn === "function") {
    try {
      return Boolean(
        (nativeFn as (a: Uint8Array, b: Uint8Array) => boolean)(bytesA, bytesB),
      );
    } catch {
      // Fall through to manual loop.
    }
  }

  let diff = 0;
  for (let i = 0; i < bytesA.length; i++) {
    diff |= bytesA[i] ^ bytesB[i];
  }
  return diff === 0;
}
