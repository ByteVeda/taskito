import { describe, expect, it } from "vitest";
import { oauthStartUrl } from "./api";

describe("oauthStartUrl", () => {
  it("returns the slot-rooted path when no next is supplied", () => {
    expect(oauthStartUrl("google")).toBe("/api/auth/oauth/start/google");
  });

  it("URL-encodes the next path so it survives querystring parsing", () => {
    expect(oauthStartUrl("google", "/jobs?status=failed")).toBe(
      "/api/auth/oauth/start/google?next=%2Fjobs%3Fstatus%3Dfailed",
    );
  });

  it("URL-encodes provider slots that contain reserved characters", () => {
    // OIDC slot names must match ^[a-z][a-z0-9_-]{0,31}$ at the server,
    // so this is defence-in-depth — but the encoding must not break the
    // slot regex on the way out.
    expect(oauthStartUrl("acme-okta", "/")).toBe("/api/auth/oauth/start/acme-okta?next=%2F");
  });

  it("ignores empty / undefined next gracefully", () => {
    expect(oauthStartUrl("github", undefined)).toBe("/api/auth/oauth/start/github");
    expect(oauthStartUrl("github", "")).toBe("/api/auth/oauth/start/github");
  });
});
