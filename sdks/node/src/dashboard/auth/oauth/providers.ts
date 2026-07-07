// Concrete providers: Google, GitHub, and generic OIDC. `exchangeCode`
// (network IO + claim normalisation) is split from `checkAllowlist`
// (pure-data permission check) so tests can drive either in isolation.
// HTTP goes through an injectable `fetch` so tests never hit the network.

import type { GitHubConfig, GoogleConfig, OidcConfig } from "./config";
import {
  AllowlistDenied,
  IdentityFetchError,
  type OAuthProvider,
  type ProviderIdentity,
} from "./identity";
import { validateIdToken } from "./idToken";

export const GOOGLE_DISCOVERY_URL = "https://accounts.google.com/.well-known/openid-configuration";
const GITHUB_AUTH_URL = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_API_BASE = "https://api.github.com";

const HTTP_TIMEOUT_MS = 10_000;

export type FetchLike = typeof fetch;

interface DiscoveryDocument {
  issuer?: string;
  authorization_endpoint?: string;
  token_endpoint?: string;
  jwks_uri?: string;
}

function emailDomain(email: string | null): string | null {
  if (!email?.includes("@")) {
    return null;
  }
  return (email.split("@").pop() ?? "").toLowerCase();
}

function domainAllowlistCheck(identity: ProviderIdentity, allowedDomains: string[]): void {
  if (allowedDomains.length === 0) {
    return;
  }
  if (!identity.email || !identity.emailVerified) {
    throw new AllowlistDenied("verified email required for domain check");
  }
  const domain = emailDomain(identity.email);
  if (!allowedDomains.some((d) => d.toLowerCase() === domain)) {
    throw new AllowlistDenied(`email domain '${domain}' is not in the allowed domains list`);
  }
}

/**
 * Discovered endpoints are attacker-influenceable via a misconfigured or
 * compromised discovery document; require https (plain http only for
 * local development hosts) before sending codes or the client secret.
 */
function requireSecureEndpoint(raw: string | undefined, field: string): string {
  if (!raw) {
    throw new IdentityFetchError(`OIDC discovery document has no ${field}`);
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new IdentityFetchError(`OIDC discovery ${field} is not a valid URL`);
  }
  const isLocal = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(parsed.hostname);
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && isLocal)) {
    throw new IdentityFetchError(`OIDC discovery ${field} must use https: ${raw}`);
  }
  return raw;
}

async function fetchJson(http: FetchLike, url: string, what: string): Promise<unknown> {
  let response: Response;
  try {
    response = await http(url, { signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
  } catch (error) {
    throw new IdentityFetchError(`${what} request failed: ${String(error)}`);
  }
  if (!response.ok) {
    throw new IdentityFetchError(`${what} returned ${response.status}`);
  }
  try {
    return await response.json();
  } catch {
    throw new IdentityFetchError(`${what} returned invalid JSON`);
  }
}

/** POST an authorization code to a token endpoint (client_secret_post). */
async function fetchToken(
  http: FetchLike,
  tokenEndpoint: string,
  params: {
    clientId: string;
    clientSecret: string;
    code: string;
    codeVerifier: string;
    redirectUri: string;
  },
): Promise<Record<string, unknown>> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: params.clientId,
    client_secret: params.clientSecret,
    code: params.code,
    code_verifier: params.codeVerifier,
    redirect_uri: params.redirectUri,
  });
  let response: Response;
  try {
    response = await http(tokenEndpoint, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: body.toString(),
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
  } catch (error) {
    throw new IdentityFetchError(`token exchange failed: ${String(error)}`);
  }
  if (!response.ok) {
    throw new IdentityFetchError(`token exchange failed: HTTP ${response.status}`);
  }
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    throw new IdentityFetchError("token endpoint returned invalid JSON");
  }
}

// ── OIDC (shared machinery for Google + generic OIDC) ───────────────────

abstract class OidcProviderBase implements OAuthProvider {
  abstract readonly slot: string;
  abstract readonly label: string;
  abstract readonly type: string;
  protected abstract readonly clientId: string;
  protected abstract readonly clientSecret: string;
  protected abstract readonly discoveryUrl: string;
  protected readonly scope: string = "openid email profile";

  private discovery?: DiscoveryDocument;
  private jwks?: { keys?: Array<Record<string, unknown>> };

  constructor(protected readonly http: FetchLike = fetch) {}

  protected extraAuthParams(): Record<string, string> {
    return {};
  }

  abstract checkAllowlist(identity: ProviderIdentity): void;

  private async getDiscovery(): Promise<DiscoveryDocument> {
    this.discovery ??= (await fetchJson(
      this.http,
      this.discoveryUrl,
      "OIDC discovery",
    )) as DiscoveryDocument;
    return this.discovery;
  }

  private async getJwks(): Promise<{ keys?: Array<Record<string, unknown>> }> {
    if (!this.jwks) {
      const discovery = await this.getDiscovery();
      const jwksUri = requireSecureEndpoint(discovery.jwks_uri, "jwks_uri");
      this.jwks = (await fetchJson(this.http, jwksUri, "JWKS fetch")) as {
        keys?: Array<Record<string, unknown>>;
      };
    }
    return this.jwks;
  }

  async authorizationUrl(params: {
    state: string;
    nonce: string;
    codeChallenge: string;
    redirectUri: string;
  }): Promise<string> {
    const discovery = await this.getDiscovery();
    const authorizationEndpoint = requireSecureEndpoint(
      discovery.authorization_endpoint,
      "authorization_endpoint",
    );
    const query = new URLSearchParams({
      response_type: "code",
      client_id: this.clientId,
      redirect_uri: params.redirectUri,
      scope: this.scope,
      state: params.state,
      nonce: params.nonce,
      code_challenge: params.codeChallenge,
      code_challenge_method: "S256",
      ...this.extraAuthParams(),
    });
    return `${authorizationEndpoint}?${query.toString()}`;
  }

  async exchangeCode(params: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
    expectedNonce: string | null;
  }): Promise<ProviderIdentity> {
    const discovery = await this.getDiscovery();
    const tokenEndpoint = requireSecureEndpoint(discovery.token_endpoint, "token_endpoint");
    const token = await fetchToken(this.http, tokenEndpoint, {
      clientId: this.clientId,
      clientSecret: this.clientSecret,
      code: params.code,
      codeVerifier: params.codeVerifier,
      redirectUri: params.redirectUri,
    });
    const idToken = token.id_token;
    if (typeof idToken !== "string" || !idToken) {
      throw new IdentityFetchError("no id_token in token response");
    }
    const claims = validateIdToken({
      idToken,
      jwks: await this.getJwks(),
      issuer: discovery.issuer,
      clientId: this.clientId,
      expectedNonce: params.expectedNonce,
    });
    return {
      slot: this.slot,
      subject: String(claims.sub),
      email: typeof claims.email === "string" ? claims.email : null,
      emailVerified: claims.email_verified === true,
      name: typeof claims.name === "string" ? claims.name : null,
      picture: typeof claims.picture === "string" ? claims.picture : null,
    };
  }
}

export class GoogleProvider extends OidcProviderBase {
  readonly slot = "google";
  readonly type = "google";
  readonly label: string;
  protected readonly clientId: string;
  protected readonly clientSecret: string;
  protected readonly discoveryUrl = GOOGLE_DISCOVERY_URL;

  constructor(
    private readonly config: GoogleConfig,
    http: FetchLike = fetch,
  ) {
    super(http);
    this.label = config.label;
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
  }

  protected override extraAuthParams(): Record<string, string> {
    const params: Record<string, string> = { prompt: "select_account" };
    // A single allowlisted domain is passed as `hd` so Google pre-selects
    // the right account. UX hint only — enforcement is in checkAllowlist.
    if (this.config.allowedDomains.length === 1 && this.config.allowedDomains[0]) {
      params.hd = this.config.allowedDomains[0];
    }
    return params;
  }

  checkAllowlist(identity: ProviderIdentity): void {
    domainAllowlistCheck(identity, this.config.allowedDomains);
  }
}

export class GenericOidcProvider extends OidcProviderBase {
  readonly slot: string;
  readonly type = "oidc";
  readonly label: string;
  protected readonly clientId: string;
  protected readonly clientSecret: string;
  protected readonly discoveryUrl: string;

  constructor(
    private readonly config: OidcConfig,
    http: FetchLike = fetch,
  ) {
    super(http);
    this.slot = config.slot;
    this.label = config.label || config.slot;
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.discoveryUrl = config.discoveryUrl;
  }

  checkAllowlist(identity: ProviderIdentity): void {
    domainAllowlistCheck(identity, this.config.allowedDomains);
  }
}

// ── GitHub (OAuth2-only, no OIDC) ────────────────────────────────────────

export class GitHubProvider implements OAuthProvider {
  readonly slot = "github";
  readonly type = "github";
  readonly label: string;
  private readonly scope = "read:user user:email";

  constructor(
    private readonly config: GitHubConfig,
    private readonly http: FetchLike = fetch,
  ) {
    this.label = config.label;
  }

  // GitHub does not implement OIDC — `nonce` is unused; PKCE is honoured.
  authorizationUrl(params: {
    state: string;
    nonce: string;
    codeChallenge: string;
    redirectUri: string;
  }): Promise<string> {
    const query = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: params.redirectUri,
      // read:org makes the membership endpoint reliable when allowlisting.
      scope: this.config.allowedOrgs.length > 0 ? `${this.scope} read:org` : this.scope,
      state: params.state,
      code_challenge: params.codeChallenge,
      code_challenge_method: "S256",
      allow_signup: "false",
    });
    return Promise.resolve(`${GITHUB_AUTH_URL}?${query.toString()}`);
  }

  async exchangeCode(params: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
    expectedNonce: string | null;
  }): Promise<ProviderIdentity> {
    const token = await fetchToken(this.http, GITHUB_TOKEN_URL, {
      clientId: this.config.clientId,
      clientSecret: this.config.clientSecret,
      code: params.code,
      codeVerifier: params.codeVerifier,
      redirectUri: params.redirectUri,
    });
    const accessToken = token.access_token;
    if (typeof accessToken !== "string" || !accessToken) {
      throw new IdentityFetchError("no access_token in token response");
    }

    const user = (await this.apiGet("/user", accessToken, "GET /user")) as {
      id?: number;
      login?: string;
      name?: string;
      avatar_url?: string;
    };
    if (user.id === undefined || !user.login) {
      throw new IdentityFetchError("GitHub /user response missing 'id' or 'login'");
    }

    const { email, verified } = await this.primaryEmail(accessToken);
    // Org membership needs the access token, so it is enforced here rather
    // than in checkAllowlist (a no-op for GitHub).
    await this.verifyOrgMembership(accessToken, user.login);

    return {
      slot: this.slot,
      subject: String(user.id),
      email,
      emailVerified: verified,
      name: user.name ?? user.login,
      picture: user.avatar_url ?? null,
    };
  }

  /** No-op — GitHub's org check happens inside exchangeCode. */
  checkAllowlist(_identity: ProviderIdentity): void {}

  private async apiGet(path: string, accessToken: string, what: string): Promise<unknown> {
    const response = await this.apiRequest(path, accessToken);
    if (!response.ok) {
      throw new IdentityFetchError(`${what} failed: ${response.status}`);
    }
    try {
      return await response.json();
    } catch {
      throw new IdentityFetchError(`${what} returned invalid JSON`);
    }
  }

  private async apiRequest(path: string, accessToken: string): Promise<Response> {
    try {
      return await this.http(`${GITHUB_API_BASE}${path}`, {
        headers: {
          authorization: `Bearer ${accessToken}`,
          accept: "application/vnd.github+json",
          "x-github-api-version": "2022-11-28",
        },
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
    } catch (error) {
      throw new IdentityFetchError(`GitHub API ${path} request failed: ${String(error)}`);
    }
  }

  /** The verified primary email, or null — unverified emails are never trusted. */
  private async primaryEmail(
    accessToken: string,
  ): Promise<{ email: string | null; verified: boolean }> {
    const response = await this.apiRequest("/user/emails", accessToken);
    if (!response.ok) {
      return { email: null, verified: false };
    }
    let entries: Array<{ email?: string; primary?: boolean; verified?: boolean }>;
    try {
      entries = (await response.json()) as typeof entries;
    } catch {
      return { email: null, verified: false };
    }
    for (const entry of entries) {
      if (entry.primary && entry.verified && entry.email) {
        return { email: entry.email, verified: true };
      }
    }
    return { email: null, verified: false };
  }

  private async verifyOrgMembership(accessToken: string, login: string): Promise<void> {
    if (this.config.allowedOrgs.length === 0) {
      return;
    }
    for (const org of this.config.allowedOrgs) {
      const response = await this.apiRequest(
        `/orgs/${encodeURIComponent(org)}/members/${encodeURIComponent(login)}`,
        accessToken,
      );
      if (response.status === 204) {
        return;
      }
      if (response.status !== 302 && response.status !== 404) {
        throw new IdentityFetchError(`GitHub org membership check failed: ${response.status}`);
      }
    }
    throw new AllowlistDenied(
      `user is not a member of any allowed GitHub org (${this.config.allowedOrgs.join(", ")})`,
    );
  }
}
