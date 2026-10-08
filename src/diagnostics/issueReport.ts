/** The GitHub repository where a host's bugs are reported. */
export interface IssueReporterConfig {
  /** A repository in owner/name form. */
  repository: string;
  appName?: string;
}

/** Validate the repository before creating a GitHub issue link. */
export function validateIssueReporterConfig(config: IssueReporterConfig): IssueReporterConfig {
  if (!/^[a-z\d][a-z\d-]{0,38}\/[a-z\d._-]{1,100}$/i.test(config.repository) || [".", ".."].includes(config.repository.split("/")[1])) {
    throw new Error("The issue repository must be in owner/name form.");
  }
  return { ...config };
}

const REDACTED = "[redacted]";

function redactUrl(value: string): string {
  // Strip these directly rather than decode/re-encode the path, so useful source
  // locations and stack frames retain their original spelling.
  return value.replace(/^(https?:\/\/)[^/\s]+@/i, "$1[redacted]@")
    .replace(/[?#].*$/, REDACTED);
}

/**
 * Redact a report without shortening its retained activity. This is a second
 * boundary after report generation: errors and activity can contain secrets
 * outside the settings fields. Known host secrets are replaced wherever they
 * occur, including common URL encodings. Heuristics cannot recognize every
 * personal detail, so the reporting UI always shows the result for review.
 */
export function redactIssueReport(text: string, secrets: readonly string[] = []): string {
  let result = text;
  const known = new Set<string>();
  for (const secret of secrets) {
    if (!secret) continue;
    known.add(secret);
    known.add(JSON.stringify(secret).slice(1, -1));
    try {
      const encoded = encodeURIComponent(secret);
      known.add(encoded);
      known.add(encoded.replace(/%20/g, "+"));
    } catch { /* A malformed Unicode value can still be replaced literally. */ }
  }
  for (const secret of [...known].sort((a, b) => b.length - a.length)) result = result.split(secret).join(REDACTED);

  result = result
    .replace(/-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z]+ )?PRIVATE KEY-----/g, REDACTED)
    .replace(/https?:\/\/[^\s<>"'`]+/gi, redactUrl)
    .replace(/(^|[\s("'`])((?:\/|\.{1,2}\/)[^\s<>"'`?#]*)([?#][^\s<>"'`]+)/g, "$1$2[redacted]")
    // Also cover relative URLs and fragments logged without an origin.
    .replace(/([?#&](?:[a-z\d_.%+-]+)=)(?:\[redacted\]|[^\s<>"'`&#)\]}]*)/gi, "$1[redacted]")
    .replace(/\b(?:Bearer|Basic)\s+[a-z\d._~+/-]+=*/gi, match => `${match.split(/\s/)[0]} ${REDACTED}`)
    .replace(/\b(?:gh[pousr]_[a-z\d]{20,}|github_pat_[a-z\d_]{20,}|AIza[a-z\d_-]{20,}|sk-[a-z\d_-]{20,}|(?:AKIA|ASIA)[a-z\d]{16})\b/gi, REDACTED)
    .replace(/\beyJ[a-z\d_-]+\.[a-z\d_-]+\.[a-z\d_-]+\b/gi, REDACTED)
    .replace(/^([ \t]*(?:Cookie|Set-Cookie|Authorization)\s*:\s*)[^\r\n]*/gim, "$1[redacted]")
    // A location setting's default is also a coordinate; omit that value too.
    .replace(/^([ \t]*(?:[a-z\d_.-]*[._-])?(?:latitude|longitude|latDeg|lonDeg|lat_deg|lon_deg|lat|lon)\s*=\s*)[^\r\n]*/gim, "$1[redacted]")
    .replace(/(["']?\b(?:latitude|longitude|latDeg|lonDeg|lat_deg|lon_deg|lat|lon)\b["']?\s*[:=]\s*)(?:\[redacted\]|"(?:\\.|[^"\\\r\n])*"|'(?:\\.|[^'\\\r\n])*'|[-+]?\d+(?:\.\d*)?(?:e[-+]?\d+)?)/gi, "$1[redacted]")
    .replace(/(["']?\b(?:[a-z\d_.-]*[._-])?(?:key|api[_ .-]?key|access[_ .-]?token|refresh[_ .-]?token|id[_ .-]?token|(?:client[_ .-]?)?secret|password|passwd|pwd|token|authorization|credentials?|pair(?:ing)?(?:[_ .-]?(?:code|secret|token))?|pin|cookies?|session[_ .-]?(?:id|token))\b["']?\s*[:=]\s*)(?:\[redacted\]|"(?:\\.|[^"\\\r\n])*"|'(?:\\.|[^'\\\r\n])*'|[^\s,;)\]}]+)/gi, "$1[redacted]")
    .replace(/\b[a-z\d.!#$%&'*+/=?^_`{|}~-]+@[a-z\d](?:[a-z\d.-]*[a-z\d])?\.[a-z]{2,}\b/gi, REDACTED);
  return result;
}

export interface IssueReportDraftInput {
  title: string;
  description: string;
  /** The complete reviewed report, used only for selected summary lines. */
  report: string;
  filename: string;
}

export interface IssueReportDraft {
  url: string;
  body: string;
  /** Some text was shortened in the draft; the attachment still has all of it. */
  shortened: boolean;
}

/** A conservative URL limit for mobile browsers and sign-in redirects. */
export const ISSUE_DRAFT_URL_LIMIT = 2_000;
const SUMMARY_FIELDS = ["Browser", "Screen", "Build", "Renderer", "GPU"] as const;
const encodedSize = (value: string): number => new URLSearchParams({ v: value }).toString().length - 2;

function fitEncoded(value: string, budget: number): string {
  if (encodedSize(value) <= budget) return value;
  const suffix = "…";
  const available = Math.max(0, budget - encodedSize(suffix));
  let fitted = "";
  let used = 0;
  for (const character of value) {
    const cost = encodedSize(character);
    if (used + cost > available) break;
    fitted += character;
    used += cost;
  }
  return budget >= encodedSize(suffix) ? `${fitted}${suffix}` : "";
}

/** The full report is a local file, never an issue URL or a remote upload. */
export function issueReportFilename(config: IssueReporterConfig | undefined, at: Date): string {
  const name = config ? validateIssueReporterConfig(config).repository.split("/")[1] : "app";
  return `${name}-bug-report-${at.toISOString().replace(/[:.]/g, "-")}.txt`;
}

export function issueReportAttachment(config: IssueReporterConfig | undefined, input: IssueReportDraftInput): string {
  const app = config ? validateIssueReporterConfig(config).repository : "this app";
  return `Bug report for ${app}\nTitle: ${redactIssueReport(input.title)}\n\nWhat happened:\n${redactIssueReport(input.description)}\n\nActivity report:\n${redactIssueReport(input.report)}`;
}

/**
 * Make a short GitHub draft with selected device/build/renderer details. The
 * encoded URL stays below 2,000 characters even with non-ASCII user text. Only
 * the draft summary is shortened; the downloadable attachment retains the
 * complete description and every activity step.
 */
export function createIssueDraft(config: IssueReporterConfig, input: IssueReportDraftInput): IssueReportDraft {
  const { repository } = validateIssueReporterConfig(config);
  if (!/^[a-z\d._-]{1,200}\.txt$/i.test(input.filename)) throw new Error("The report filename must be a short .txt filename.");
  const base = `https://github.com/${repository}/issues/new`;
  const title = fitEncoded(redactIssueReport(input.title.trim()), 240);
  const description = redactIssueReport(input.description.trim());
  const lines = redactIssueReport(input.report).split("\n");
  const details = SUMMARY_FIELDS.map(field => lines.find(line => line.startsWith(`${field}: `))?.slice(field.length + 2) ?? "not recorded");
  const heading = "What happened (summary):\n";
  const summaryHeading = "\n\nDevice, build and renderer (summary):\n";
  const footer = `\n\nAttach the downloaded file ${input.filename} to this issue. It contains the full description and activity report. Review it first: GitHub attachments become public when uploaded. Submit publishes the issue.`;
  const labels = SUMMARY_FIELDS.map(field => `${field}: `);
  const fixed = heading + summaryHeading + labels.join("\n") + footer;
  const available = Math.max(0, ISSUE_DRAFT_URL_LIMIT - base.length - "?title=".length - encodedSize(title) - "&body=".length - encodedSize(fixed));
  const descriptionBudget = Math.floor(available * 0.4);
  const detailBudget = Math.floor((available - descriptionBudget) / details.length);
  const shortDescription = fitEncoded(description, descriptionBudget);
  const shortDetails = details.map(detail => fitEncoded(detail, detailBudget));
  const body = `${heading}${shortDescription}${summaryHeading}${shortDetails.map((detail, index) => `${labels[index]}${detail}`).join("\n")}${footer}`;
  const url = new URL(base);
  url.searchParams.set("title", title);
  url.searchParams.set("body", body);
  return { url: url.href, body, shortened: title !== input.title.trim() || shortDescription !== description || shortDetails.some((detail, index) => detail !== details[index]) };
}
