/** Crockford base32 (no I, L, O, U) – easy to read off a printed label. */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** 16-char (80-bit) random public token, e.g. for certificate QR verification. */
export function newPublicToken(length = 16): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += ALPHABET[b & 31];
  return out;
}

/** Normalise user/URL input: upper-case, strip spaces/dashes, map look-alikes. */
export function normalizeToken(input: string): string {
  return input
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
}

/** Human-friendly grouping: ABCD-EFGH-JKMN-PQRS. */
export function formatToken(token: string): string {
  return token.match(/.{1,4}/g)?.join("-") ?? token;
}
