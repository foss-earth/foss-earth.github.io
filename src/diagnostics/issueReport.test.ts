import { describe, expect, it } from "vitest";
import { createIssueDraft, ISSUE_DRAFT_URL_LIMIT, issueReportAttachment, issueReportFilename, redactIssueReport, validateIssueReporterConfig } from "./issueReport";

describe("issue reporter configuration", () => {
  it("accepts the three apps' GitHub repositories", () => {
    for (const repository of ["UMN-VR/UMN-VR.github.io", "0SFS/0SFS.github.io", "FOSS-Earth/FOSS-Earth.github.io"]) {
      expect(validateIssueReporterConfig({ repository, appName: "Globe" })).toEqual({ repository, appName: "Globe" });
    }
  });

  it.each(["org", "org/app/more", "/app", "org/..", "org/.", "org/app?body=x", "org/app#x", "org/name with spaces"])("rejects repository %s", repository => {
    expect(() => validateIssueReporterConfig({ repository })).toThrow("owner/name");
  });
});

describe("public issue report redaction", () => {
  it("removes URL credentials, queries and fragments while preserving useful paths", () => {
    const raw = [
      "Page: https://name:password@tour.example/tour/?panorama=mall&token=sensitive#pair-secret",
      "Tile https://tiles.example/1/2/3.png?key=tile-secret returned 403",
      "Scene /tour/#private-hash and ./scene.json?key=other-secret",
      "Pair URL ?code=code-secret&token=more-secret",
    ].join("\n");
    const report = redactIssueReport(raw);
    for (const value of ["name", "password", "mall", "sensitive", "pair-secret", "tile-secret", "private-hash", "other-secret", "code-secret", "more-secret"]) {
      expect(report).not.toContain(value);
    }
    expect(report).toContain("https://[redacted]@tour.example/tour/[redacted]");
    expect(report).toContain("https://tiles.example/1/2/3.png[redacted] returned 403");
    expect(report).toContain("Scene /tour/[redacted] and ./scene.json[redacted]");
  });

  it("removes secrets in headers, settings, pairing messages, JSON and obvious tokens", () => {
    const raw = [
      "Authorization: Bearer abc.DEF-123_456",
      "Basic YWxhZGRpbjpvcGVuc2VzYW1l",
      "map.apiKey = tile-api-secret (saved; default none)",
      "google_api_key=another-secret",
      'headers {"token":"JSON token with spaces","password":"escaped \\"password\\""}',
      "pairing code = 126789",
      "pair-secret: secret-pairing-value",
      "Cookie: session-cookie-value",
      "Session token: session-private-token",
      "mail me at tester@example.com",
      "ghp_abcdefghijklmnopqrstuvwxyz123456789012",
      "github_pat_abcdefghijklmnopqrstuvwxyz123456789012",
      "AIzaabcdefghijklmnopqrstuvwxyz1234567890",
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJwcml2YXRlIn0.signature",
      "-----BEGIN PRIVATE KEY-----\nprivate-key-value\n-----END PRIVATE KEY-----",
    ].join("\n");
    const report = redactIssueReport(raw);
    for (const value of [
      "abc.DEF-123_456", "YWxhZGRpbjpvcGVuc2VzYW1l", "tile-api-secret", "another-secret", "JSON token with spaces", "escaped",
      "126789", "secret-pairing-value", "session-cookie-value", "session-private-token", "tester@example.com",
      "abcdefghijklmnopqrstuvwxyz", "eyJhbGci", "private-key-value",
    ]) expect(report).not.toContain(value);
    expect(report).toContain("map.apiKey = [redacted] (saved; default none)");
  });

  it("redacts known host secrets wherever they appear, including common encodings", () => {
    const secret = 'hidden secret"value';
    const report = redactIssueReport([
      `Failed with ${secret}`,
      `Encoded: ${encodeURIComponent(secret)}`,
      `Form encoded: ${encodeURIComponent(secret).replace(/%20/g, "+")}`,
      `JSON: ${JSON.stringify(secret)}`,
    ].join("\n"), [secret, "", "short"]);
    expect(report).toBe('Failed with [redacted]\nEncoded: [redacted]\nForm encoded: [redacted]\nJSON: "[redacted]"');
  });

  it("redacts coordinates in console payloads and settings without removing GPU or vector details", () => {
    const report = redactIssueReport([
      'Warning: physics state {"position":{"latDeg":44.975123,"lonDeg":-93.234567},"vector":{"x":2,"y":3,"z":4},"maxTextureSize":16384}',
      "state latitude: 44.999 longitude=-93.777 lat_deg=45.555 lon_deg: '-94.888'",
      "  camera.lat = 44.1234 (saved; default 43.4321)",
      "  camera.longitude = -93.1234 (saved; default -92.4321)",
    ].join("\n"));
    for (const coordinate of ["44.975123", "-93.234567", "44.999", "-93.777", "45.555", "-94.888", "44.1234", "43.4321", "-93.1234", "-92.4321"]) {
      expect(report).not.toContain(coordinate);
    }
    expect(report).toContain('"vector":{"x":2,"y":3,"z":4},"maxTextureSize":16384');
    expect(report).toContain("  camera.lat = [redacted]");
  });

  it("can be applied repeatedly while a person edits a preview", () => {
    const once = redactIssueReport('Page: https://user:pass@tour.example/?token=secret#pair\n?code=secret&token=secret\n{"token":"secret","latDeg":44.123}\napiKey=private-key');
    expect(redactIssueReport(once)).toBe(once);
  });

  it("preserves every retained activity step and the complete browser and renderer details", () => {
    const report = [
      "Browser: Mozilla/5.0 (Android 15; Mobile; rv:144.0) Gecko/144.0 Firefox/144.0",
      "Renderer: webgl2; GPU: Adreno 740; largest texture 16384 px",
      ...Array.from({ length: 500 }, (_, index) => `  ${index / 10} s Scene loaded panorama-${index} ${"details ".repeat(50)}`),
    ].join("\n");
    expect(report.length).toBeGreaterThan(200_000);
    expect(redactIssueReport(report)).toBe(report);
  });
});

describe("local report attachment and GitHub draft", () => {
  const config = { repository: "UMN-VR/UMN-VR.github.io" };
  const input = {
    title: "The panorama goes black",
    description: "I opened the mall panorama and the screen went black.",
    filename: "tour-report.txt",
    report: [
      "Browser: Android Firefox Mobile",
      "Screen: 360 × 800 CSS px; touch",
      "Build: abc123 · source def456",
      "Renderer: webgl2 (asked for webgl2); lost 1 time",
      "GPU: Adreno 740",
      "This visit, oldest first:",
      "0.0 s Loaded panorama mall",
      "4.0 s PRIVATE_ACTIVITY_MARKER",
    ].join("\n"),
  };

  it("uses a filesystem-safe UTC filename and keeps the full reviewed input in the file", () => {
    expect(issueReportFilename(config, new Date("2026-10-08T14:15:16.123Z")))
      .toBe("UMN-VR.github.io-bug-report-2026-10-08T14-15-16-123Z.txt");
    const attachment = issueReportAttachment(config, input);
    expect(attachment).toContain(`Title: ${input.title}`);
    expect(attachment).toContain(input.description);
    expect(attachment).toContain(input.report);
  });

  it("prefills a short summary and filename instructions, with no full activity in the URL", () => {
    const draft = createIssueDraft(config, input);
    const url = new URL(draft.url);
    expect(url.origin).toBe("https://github.com");
    expect(url.pathname).toBe("/UMN-VR/UMN-VR.github.io/issues/new");
    expect(url.searchParams.get("title")).toBe(input.title);
    expect(url.searchParams.get("body")).toBe(draft.body);
    for (const detail of ["Android Firefox Mobile", "webgl2", "abc123", "Adreno 740", input.filename]) expect(draft.body).toContain(detail);
    expect(draft.body).toContain("GitHub attachments become public when uploaded");
    expect(draft.url).not.toContain("PRIVATE_ACTIVITY_MARKER");
    expect(draft.body).not.toContain("Loaded panorama mall");
    expect(draft.url.length).toBeLessThanOrEqual(ISSUE_DRAFT_URL_LIMIT);
  });

  it("bounds the encoded URL with huge Unicode text without shortening the downloaded report", () => {
    const hugeInput = {
      title: "問題🌎".repeat(500),
      description: "細かい再現手順🌎".repeat(2_000),
      filename: issueReportFilename({ repository: `${"o".repeat(39)}/${"r".repeat(100)}` }, new Date("2026-10-08T14:15:16.123Z")),
      report: `${["Browser", "Screen", "Build", "Renderer", "GPU"].map(field => `${field}: ${"詳細🌎".repeat(1_000)}`).join("\n")}\n${"activity ".repeat(10_000)}`,
    };
    const draft = createIssueDraft({ repository: `${"o".repeat(39)}/${"r".repeat(100)}` }, hugeInput);
    expect(draft.url.length).toBeLessThanOrEqual(ISSUE_DRAFT_URL_LIMIT);
    expect(draft.shortened).toBe(true);
    expect(draft.body).toContain(hugeInput.filename);
    const attachment = issueReportAttachment(config, hugeInput);
    expect(attachment).toContain(hugeInput.title);
    expect(attachment).toContain(hugeInput.description);
    expect(attachment).toContain(hugeInput.report);
  });

  it("redacts selected summary lines and rejects unsafe filenames", () => {
    const draft = createIssueDraft(config, { ...input, report: "Browser: tester@example.com\nBuild: apiKey=secret-value\nRenderer: webgl2" });
    expect(draft.body).not.toContain("tester@example.com");
    expect(draft.body).not.toContain("secret-value");
    expect(() => createIssueDraft(config, { ...input, filename: "../secret.txt" })).toThrow("filename");
    expect(() => createIssueDraft(config, { ...input, filename: `${"x".repeat(1_000)}.txt` })).toThrow("filename");
  });
});
