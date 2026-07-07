// RFC 7636 PKCE code-challenge derivation.

import { createHash } from "node:crypto";

/** S256 challenge: base64url(sha256(verifier)) without padding. */
export function s256Challenge(verifier: string): string {
  return createHash("sha256").update(verifier, "ascii").digest("base64url");
}
