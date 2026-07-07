// Provider-agnostic identity types + the error taxonomy the flow layer maps
// to login-page redirects.

/** Base class for OAuth flow failures. */
export class OAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** The `state` parameter is missing, expired, replayed, or mismatched. */
export class StateValidationError extends OAuthError {}

/** Token exchange, userinfo fetch, or id_token claim validation failed. */
export class IdentityFetchError extends OAuthError {}

/** The identity is valid but outside the configured allowlist. */
export class AllowlistDenied extends OAuthError {}

/** The requested provider slot has no configuration. */
export class ProviderNotConfigured extends OAuthError {}

/** A normalised identity returned by a provider after code exchange. */
export interface ProviderIdentity {
  slot: string;
  subject: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
  picture: string | null;
}

/** The contract every provider implements. */
export interface OAuthProvider {
  readonly slot: string;
  readonly label: string;
  readonly type: string;
  /** The provider's `/authorize` URL carrying state/nonce/PKCE. */
  authorizationUrl(params: {
    state: string;
    nonce: string;
    codeChallenge: string;
    redirectUri: string;
  }): Promise<string>;
  /** Exchange the auth code for a verified identity. */
  exchangeCode(params: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
    expectedNonce: string | null;
  }): Promise<ProviderIdentity>;
  /** Pure-data allowlist check; throws {@link AllowlistDenied}. */
  checkAllowlist(identity: ProviderIdentity): void;
}
