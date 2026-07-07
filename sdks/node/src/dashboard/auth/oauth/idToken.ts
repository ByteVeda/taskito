// OIDC id_token validation on node:crypto — signature against the
// provider's JWKS, then issuer/audience/nonce/expiry claim checks. Only the
// asymmetric algorithms OIDC providers actually issue are accepted; `none`
// and HMAC algorithms are rejected outright.

import {
  constants,
  createPublicKey,
  createVerify,
  type KeyObject,
  verify as verifyRaw,
} from "node:crypto";
import { IdentityFetchError } from "./identity";

/** 60s clock-skew tolerance on `exp`, matching the reference behaviour. */
const CLOCK_SKEW_SECONDS = 60;

interface JwtHeader {
  alg?: string;
  kid?: string;
}

export interface IdTokenClaims {
  iss?: string;
  aud?: string | string[];
  sub?: string;
  nonce?: string;
  exp?: number;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
  [claim: string]: unknown;
}

interface Jwk {
  kty?: string;
  kid?: string;
  [field: string]: unknown;
}

function decodeSegment(segment: string, what: string): Record<string, unknown> {
  try {
    return JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
  } catch {
    throw new IdentityFetchError(`id_token ${what} is not valid base64url JSON`);
  }
}

/** Verify one signature with the algorithm the token header names. */
function verifySignature(alg: string, key: KeyObject, data: Buffer, signature: Buffer): boolean {
  switch (alg) {
    case "RS256":
    case "RS384":
    case "RS512": {
      const hash = `RSA-SHA${alg.slice(2)}`;
      return createVerify(hash).update(data).verify(key, signature);
    }
    case "PS256":
    case "PS384":
    case "PS512":
      return verifyRaw(
        `sha${alg.slice(2)}`,
        data,
        {
          key,
          padding: constants.RSA_PKCS1_PSS_PADDING,
          saltLength: Number(alg.slice(2)) / 8,
        },
        signature,
      );
    case "ES256":
    case "ES384":
    case "ES512":
      return verifyRaw(`sha${alg.slice(2)}`, data, { key, dsaEncoding: "ieee-p1363" }, signature);
    default:
      throw new IdentityFetchError(`id_token uses unsupported algorithm '${alg}'`);
  }
}

/** Candidate JWKS keys for a token: exact `kid` match, else every key. */
function candidateKeys(keys: Jwk[], kid: string | undefined): Jwk[] {
  if (kid) {
    const matched = keys.filter((key) => key.kid === kid);
    if (matched.length > 0) {
      return matched;
    }
  }
  return keys;
}

/**
 * Validate an id_token against a JWKS and the expected issuer, audience,
 * and nonce. Returns the verified claims; throws {@link IdentityFetchError}
 * on any failure.
 */
export function validateIdToken(options: {
  idToken: string;
  jwks: { keys?: Jwk[] };
  issuer: string | undefined;
  clientId: string;
  expectedNonce: string | null;
  nowSeconds?: number;
}): IdTokenClaims {
  const parts = options.idToken.split(".");
  if (parts.length !== 3) {
    throw new IdentityFetchError("id_token is not a compact JWT");
  }
  const [headerB64, payloadB64, signatureB64] = parts as [string, string, string];
  const header = decodeSegment(headerB64, "header") as JwtHeader;
  if (!header.alg) {
    throw new IdentityFetchError("id_token header missing 'alg'");
  }

  const signedData = Buffer.from(`${headerB64}.${payloadB64}`, "ascii");
  const signature = Buffer.from(signatureB64, "base64url");
  const keys = options.jwks.keys ?? [];
  if (keys.length === 0) {
    throw new IdentityFetchError("provider JWKS contains no keys");
  }

  let verified = false;
  for (const jwk of candidateKeys(keys, header.kid)) {
    let key: KeyObject;
    try {
      key = createPublicKey({ key: jwk as never, format: "jwk" });
    } catch {
      continue; // skip malformed / symmetric keys
    }
    try {
      if (verifySignature(header.alg, key, signedData, signature)) {
        verified = true;
        break;
      }
    } catch (error) {
      if (error instanceof IdentityFetchError) {
        throw error; // unsupported algorithm — fail loudly, don't try other keys
      }
    }
  }
  if (!verified) {
    throw new IdentityFetchError("id_token signature validation failed");
  }

  const claims = decodeSegment(payloadB64, "payload") as IdTokenClaims;
  if (options.issuer && claims.iss !== options.issuer) {
    throw new IdentityFetchError(
      `id_token issuer mismatch: expected '${options.issuer}', got '${String(claims.iss)}'`,
    );
  }
  const aud = claims.aud;
  const audienceOk =
    typeof aud === "string"
      ? aud === options.clientId
      : Array.isArray(aud) && aud.includes(options.clientId);
  if (!audienceOk) {
    throw new IdentityFetchError(`id_token audience mismatch: ${JSON.stringify(aud)}`);
  }
  if (options.expectedNonce !== null && claims.nonce !== options.expectedNonce) {
    throw new IdentityFetchError("id_token nonce mismatch");
  }
  const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (typeof claims.exp === "number" && claims.exp < now - CLOCK_SKEW_SECONDS) {
    throw new IdentityFetchError("id_token expired");
  }
  if (!claims.sub) {
    throw new IdentityFetchError("id_token missing 'sub' claim");
  }
  return claims;
}
