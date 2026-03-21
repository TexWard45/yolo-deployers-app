import assert from "node:assert/strict";
import test from "node:test";
import { linearService } from "./linear.service";

test("linearService implements TrackerService interface", () => {
  assert.equal(typeof linearService.validateToken, "function");
  assert.equal(typeof linearService.listProjects, "function");
  assert.equal(typeof linearService.createIssue, "function");
});

test("validateToken returns false for invalid token", async () => {
  const result = await linearService.validateToken("invalid_token_abc");
  assert.equal(result, false);
});

test("listProjects throws for invalid token", async () => {
  await assert.rejects(
    () => linearService.listProjects("invalid_token_abc"),
    (err: Error) => {
      assert.ok(err.message.length > 0);
      return true;
    },
  );
});

test("createIssue throws for invalid token", async () => {
  await assert.rejects(
    () =>
      linearService.createIssue({
        apiToken: "invalid_token_abc",
        projectKey: "fake-team-id",
        title: "Test Issue",
      }),
    (err: Error) => {
      assert.ok(err.message.length > 0);
      return true;
    },
  );
});
