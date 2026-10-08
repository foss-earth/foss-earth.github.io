import { validateIssueReporterConfig, type IssueReporterConfig } from "../diagnostics/issueReport";

/** The consuming app's GitHub repository, already stamped into each static build. */
export function issueReporterFromBuild(): IssueReporterConfig | undefined {
  const repository = typeof __REPOSITORY_SLUG__ === "string" ? __REPOSITORY_SLUG__ : "";
  if (!repository) return undefined;
  // The UI presents an invalid configuration with a useful explanation rather
  // than preventing the map or flight app from starting.
  const config = { repository };
  try { return validateIssueReporterConfig(config); } catch { return config; }
}
