import assert from "node:assert/strict";
import test from "node:test";
import { createDraftPullRequest, listCommitChecks } from "./github-client";

test("createDraftPullRequest returns the PR link and number", async () => {
  const client = {
    pulls: {
      create: async () => ({
        data: {
          html_url: "https://github.com/acme/repo/pull/42",
          number: 42,
        },
      }),
    },
  };

  const result = await createDraftPullRequest(client as never, {
    owner: "acme",
    repo: "repo",
    title: "fix: issue",
    body: "body",
    head: "branch",
    base: "main",
  });

  assert.deepEqual(result, {
    prUrl: "https://github.com/acme/repo/pull/42",
    prNumber: 42,
  });
});

test("listCommitChecks returns check names for the ref", async () => {
  const client = {
    checks: {
      listForRef: async () => ({
        data: {
          check_runs: [
            { name: "build-web" },
            { name: "lint" },
          ],
        },
      }),
    },
  };

  const result = await listCommitChecks(client as never, {
    owner: "acme",
    repo: "repo",
    ref: "abc123",
  });

  assert.deepEqual(result, ["build-web", "lint"]);
});
