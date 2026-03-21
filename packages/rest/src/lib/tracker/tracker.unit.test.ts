import assert from "node:assert/strict";
import test from "node:test";
import { getTrackerService } from "./index";

test("getTrackerService returns linearService for LINEAR type", () => {
  const service = getTrackerService("LINEAR");
  assert.ok(service);
  assert.equal(typeof service.validateToken, "function");
  assert.equal(typeof service.listProjects, "function");
  assert.equal(typeof service.createIssue, "function");
});

test("getTrackerService throws for unsupported type", () => {
  assert.throws(
    () => getTrackerService("GITHUB_ISSUES"),
    (err: Error) => {
      assert.ok(err.message.includes("Unsupported tracker type"));
      return true;
    },
  );
});

test("getTrackerService throws for empty string", () => {
  assert.throws(
    () => getTrackerService(""),
    (err: Error) => {
      assert.ok(err.message.includes("Unsupported tracker type"));
      return true;
    },
  );
});

test("getTrackerService is case-sensitive", () => {
  assert.throws(
    () => getTrackerService("linear"),
    (err: Error) => {
      assert.ok(err.message.includes("Unsupported tracker type"));
      return true;
    },
  );
});
