// The SSO id_token is now VERIFIED, not decoded on trust (ctg-sso/verify.ts). This drives the verifier
// with a locally generated ES256 key — no network, so the suite stays `--allow-read`-only — and proves
// it accepts a good token and REJECTS the three ways a forged one differs: wrong audience, bad
// signature, expired. Each was checked by watching it fail before the pin was written.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { generateKeyPair, SignJWT, type KeyLike } from "npm:jose@5";
import { verifyIdToken } from "../supabase/functions/ctg-sso/verify.ts";

const ISS = "https://api.ctg-portal.com";
const AUD = "app-id-123";

const good = await generateKeyPair("ES256");
const other = await generateKeyPair("ES256");   // a different signer, for the bad-signature case

/** A signed ES256 token, with overridable claims/expiry so each case bends exactly one thing. */
async function mint(over: { iss?: string; aud?: string; exp?: string | number; key?: KeyLike } = {}): Promise<string> {
  let b = new SignJWT({ email: "person@ctg.com" })
    .setProtectedHeader({ alg: "ES256" })
    .setSubject("sub-abc")
    .setIssuer(over.iss ?? ISS)
    .setAudience(over.aud ?? AUD)
    .setIssuedAt();
  b = b.setExpirationTime(over.exp ?? "5m");
  return await b.sign(over.key ?? good.privateKey);
}

Deno.test("a good ES256 token verifies and its claims come back", async () => {
  const claims = await verifyIdToken(await mint(), good.publicKey, { issuer: ISS, audience: AUD });
  assertEquals(claims.sub, "sub-abc");
  assertEquals(claims.email, "person@ctg.com");
});

Deno.test("a token for the WRONG audience is rejected", async () => {
  await assertRejects(async () => verifyIdToken(await mint({ aud: "some-other-app" }), good.publicKey, { issuer: ISS, audience: AUD }));
});

Deno.test("a token signed by a DIFFERENT key (bad signature) is rejected", async () => {
  await assertRejects(async () => verifyIdToken(await mint({ key: other.privateKey }), good.publicKey, { issuer: ISS, audience: AUD }));
});

Deno.test("an EXPIRED token is rejected", async () => {
  // exp two minutes in the past — jose checks it against the current clock.
  await assertRejects(async () => verifyIdToken(await mint({ exp: Math.floor(Date.now() / 1000) - 120 }), good.publicKey, { issuer: ISS, audience: AUD }));
});

Deno.test("a token from the WRONG issuer is rejected", async () => {
  await assertRejects(async () => verifyIdToken(await mint({ iss: "https://evil.example.com" }), good.publicKey, { issuer: ISS, audience: AUD }));
});

/** Local assertRejects — std's is fine too, but this keeps the intent obvious at each call site. */
async function assertRejects(fn: () => Promise<unknown>): Promise<void> {
  let threw = false;
  try { await fn(); } catch { threw = true; }
  assert(threw, "expected verification to reject, but it resolved");
}
