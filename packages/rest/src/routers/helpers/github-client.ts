import { Octokit } from "@octokit/rest";

export interface CreateDraftPullRequestInput {
  owner: string;
  repo: string;
  title: string;
  body: string;
  head: string;
  base: string;
}

export function createGitHubClient(token: string): Octokit {
  return new Octokit({ auth: token });
}

export async function createDraftPullRequest(
  client: Octokit,
  input: CreateDraftPullRequestInput,
): Promise<{ prUrl: string; prNumber: number }> {
  const response = await client.pulls.create({
    owner: input.owner,
    repo: input.repo,
    title: input.title,
    body: input.body,
    head: input.head,
    base: input.base,
    draft: true,
  });

  return {
    prUrl: response.data.html_url,
    prNumber: response.data.number,
  };
}

export async function listCommitChecks(
  client: Octokit,
  params: { owner: string; repo: string; ref: string },
): Promise<string[]> {
  const response = await client.checks.listForRef({
    owner: params.owner,
    repo: params.repo,
    ref: params.ref,
  });

  return response.data.check_runs.map((checkRun) => checkRun.name);
}
