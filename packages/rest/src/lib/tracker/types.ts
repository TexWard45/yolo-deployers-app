export interface TrackerProject {
  id: string;
  name: string;
  key: string;
}

export interface TrackerIssueResult {
  id: string;
  identifier: string;
  url: string;
}

export interface CreateTrackerIssueParams {
  apiToken: string;
  siteUrl?: string | null;
  projectKey: string;
  title: string;
  description?: string | null;
  configJson?: Record<string, unknown> | null;
}

export interface TrackerService {
  validateToken(apiToken: string, siteUrl?: string | null): Promise<boolean>;
  listProjects(apiToken: string, siteUrl?: string | null): Promise<TrackerProject[]>;
  createIssue(params: CreateTrackerIssueParams): Promise<TrackerIssueResult>;
}
