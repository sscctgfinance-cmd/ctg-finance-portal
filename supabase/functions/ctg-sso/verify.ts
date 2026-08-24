// id_token verification for the SSO callback, split out so it can be tested without booting the
// function (index.ts runs Deno.serve at import). The whole security change of this PR lives here:
// the callback used to decode the id_token's payload on trust; it now verifies the signature against
// CTG Portal's published JWKS.
//
// A key resolver is passed IN rather than created here, so the test drives verifyIdToken() with a
// locally generated ES256 public key and no network — the same reason the pure halves of the React
// screens take their inputs as arguments.

import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey, type KeyLike } from "npm:jose@5";

/** CTG Portal's JWKS, fetched lazily and cached by jose — one resolver per process, not per login. */
export function remoteJwks(jwksUrl: string): JWTVerifyGetKey {
  return createRemoteJWKSet(new URL(jwksUrl));
}

/**
 * Verify a CTG id_token. Pins ES256 (so a token re-signed with a symmetric `alg` or `none` is rejected),
 * the issuer (the portal origin) and the audience (our app_id); jose enforces `exp`/`nbf` itself. Throws
 * on any failure — the caller turns that into a refusal page.
 */
export async function verifyIdToken(
  jwt: string,
  keySet: JWTVerifyGetKey | KeyLike | CryptoKey | Uint8Array,
  opts: { issuer: string; audience: string },
): Promise<JWTPayload> {
  const { payload } = await jwtVerify(jwt, keySet as JWTVerifyGetKey, {
    algorithms: ["ES256"],
    issuer: opts.issuer,
    audience: opts.audience,
  });
  return payload;
}
