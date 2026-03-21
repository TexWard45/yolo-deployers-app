import { LinearClient } from "@linear/sdk";
import type { TrackerService, TrackerProject, TrackerIssueResult, CreateTrackerIssueParams } from "./types";

export const linearService: TrackerService = {
  async validateToken(apiToken: string): Promise<boolean> {
    try {
      const client = new LinearClient({ apiKey: apiToken });
      const viewer = await client.viewer;
      return !!viewer.id;
    } catch {
      return false;
    }
  },

  async listProjects(apiToken: string): Promise<TrackerProject[]> {
    const client = new LinearClient({ apiKey: apiToken });
    const teams = await client.teams();
    return teams.nodes.map((t: { id: string; name: string; key: string }) => ({
      id: t.id,
      name: t.name,
      key: t.key,
    }));
  },

  async createIssue(params: CreateTrackerIssueParams): Promise<TrackerIssueResult> {
    const client = new LinearClient({ apiKey: params.apiToken });
    const result = await client.createIssue({
      teamId: params.projectKey,
      title: params.title,
      description: params.description ?? undefined,
    });

    const issue = await result.issue;
    if (!issue) {
      throw new Error("Linear createIssue returned no issue");
    }

    return {
      id: issue.id,
      identifier: issue.identifier,
      url: issue.url,
    };
  },
};
