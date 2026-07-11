import { describe, expect, it } from "vitest";
import { applyJobContext, isSafeLinkUrl, parseExternalLinks } from "./derived";

describe("isSafeLinkUrl", () => {
  it("allows http and https URLs", () => {
    expect(isSafeLinkUrl("https://grafana.example.com/d/abc")).toBe(true);
    expect(isSafeLinkUrl("http://localhost:3000")).toBe(true);
  });

  it("allows same-origin paths but not protocol-relative URLs", () => {
    expect(isSafeLinkUrl("/jobs")).toBe(true);
    expect(isSafeLinkUrl("//evil.com")).toBe(false);
  });

  it("rejects javascript:, data:, and other schemes", () => {
    expect(isSafeLinkUrl("javascript:alert(document.cookie)")).toBe(false);
    expect(isSafeLinkUrl("data:text/html,<script>alert(1)</script>")).toBe(false);
    expect(isSafeLinkUrl("vbscript:x")).toBe(false);
    expect(isSafeLinkUrl("file:///etc/passwd")).toBe(false);
  });

  it("rejects relative fragments and garbage", () => {
    expect(isSafeLinkUrl("jobs")).toBe(false);
    expect(isSafeLinkUrl("")).toBe(false);
    expect(isSafeLinkUrl("   ")).toBe(false);
  });

  it("tolerates surrounding whitespace", () => {
    expect(isSafeLinkUrl("  https://example.com  ")).toBe(true);
    expect(isSafeLinkUrl("  javascript:alert(1)  ")).toBe(false);
  });
});

describe("parseExternalLinks", () => {
  it("returns [] for undefined or empty input", () => {
    expect(parseExternalLinks(undefined)).toEqual([]);
    expect(parseExternalLinks("")).toEqual([]);
  });

  it("returns [] for invalid JSON", () => {
    expect(parseExternalLinks("not json")).toEqual([]);
    expect(parseExternalLinks("{")).toEqual([]);
  });

  it("returns [] when JSON is not an array", () => {
    expect(parseExternalLinks('{"label":"x","url":"y"}')).toEqual([]);
    expect(parseExternalLinks("null")).toEqual([]);
    expect(parseExternalLinks("42")).toEqual([]);
  });

  it("parses well-formed array entries", () => {
    const raw = JSON.stringify([
      { label: "Docs", url: "https://docs.example.com" },
      { label: "Repo", url: "https://github.com/example" },
    ]);
    expect(parseExternalLinks(raw)).toEqual([
      { label: "Docs", url: "https://docs.example.com" },
      { label: "Repo", url: "https://github.com/example" },
    ]);
  });

  it("filters out entries missing label or url", () => {
    const raw = JSON.stringify([
      { label: "Docs", url: "https://docs.example.com" },
      { label: "Missing url" },
      { url: "https://nolabel.example.com" },
      { label: 42, url: "https://wrong-type.example.com" },
      null,
      "string",
    ]);
    expect(parseExternalLinks(raw)).toEqual([{ label: "Docs", url: "https://docs.example.com" }]);
  });

  it("strips extra fields, keeping only label and url", () => {
    const raw = JSON.stringify([{ label: "Docs", url: "/d", danger: "<script>" }]);
    expect(parseExternalLinks(raw)).toEqual([{ label: "Docs", url: "/d" }]);
  });

  it("drops entries whose URL scheme is unsafe", () => {
    const raw = JSON.stringify([
      { label: "Docs", url: "https://docs.example.com" },
      { label: "Evil", url: "javascript:alert(1)" },
      { label: "Data", url: "data:text/html,x" },
      { label: "Proto-relative", url: "//evil.com" },
    ]);
    expect(parseExternalLinks(raw)).toEqual([{ label: "Docs", url: "https://docs.example.com" }]);
  });
});

describe("applyJobContext", () => {
  it("returns the template unchanged when no placeholder", () => {
    expect(applyJobContext("https://example.com/dashboard", "abc123")).toBe(
      "https://example.com/dashboard",
    );
  });

  it("substitutes a single {job_id}", () => {
    expect(applyJobContext("https://example.com/jobs/{job_id}", "abc123")).toBe(
      "https://example.com/jobs/abc123",
    );
  });

  it("substitutes multiple {job_id} occurrences", () => {
    expect(applyJobContext("/{job_id}/log/{job_id}", "abc")).toBe("/abc/log/abc");
  });

  it("URL-encodes special characters in the job id", () => {
    expect(applyJobContext("https://example.com/{job_id}", "a/b c?d&e")).toBe(
      "https://example.com/a%2Fb%20c%3Fd%26e",
    );
  });

  it("handles an empty job id", () => {
    expect(applyJobContext("/jobs/{job_id}", "")).toBe("/jobs/");
  });
});
