// tests/agents-md.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { updateAgentsMd } from "../src/store/agents-md.js";
import type { LearnedRule } from "../src/types.js";

test("updateAgentsMd updates delimited block and enforces hard line cap with LRU eviction", (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-learner-agents-"));
  const agentsFile = path.join(tmpDir, "AGENTS.md");

  t.after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  fs.writeFileSync(agentsFile, "# Developer Guidelines\nCustom human rules.\n", "utf8");

  const rules: LearnedRule[] = [
    { id: "1", tier: 2, toolName: "bash", pattern: "p1", recommendation: "Rule 1", sessionCount: 3, lastSeenTimestamp: 100 },
    { id: "2", tier: 2, toolName: "bash", pattern: "p2", recommendation: "Rule 2", sessionCount: 4, lastSeenTimestamp: 200 },
    { id: "3", tier: 2, toolName: "bash", pattern: "p3", recommendation: "Rule 3", sessionCount: 5, lastSeenTimestamp: 300 },
  ];

  // Set line cap to 2 rules
  const res = updateAgentsMd(agentsFile, rules, 2);
  assert.equal(res.updated, true);
  assert.equal(res.ruleCount, 2);

  const content = fs.readFileSync(agentsFile, "utf8");
  assert.match(content, /Developer Guidelines/); // Preserved human content
  assert.match(content, /<!-- pi-learner:start -->/);
  assert.match(content, /Rule 3/); // Most recent
  assert.match(content, /Rule 2/);
  assert.doesNotMatch(content, /Rule 1/); // Evicted via LRU!
});

test("updateAgentsMd returns updated: false if no tier 2 rules", (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-learner-agents-"));
  const agentsFile = path.join(tmpDir, "AGENTS.md");

  t.after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const rules: LearnedRule[] = [
    { id: "1", tier: 1, toolName: "bash", pattern: "p1", recommendation: "Rule 1", sessionCount: 3, lastSeenTimestamp: 100 },
  ];

  const res = updateAgentsMd(agentsFile, rules, 10);
  assert.equal(res.updated, false);
  assert.equal(res.ruleCount, 0);
  assert.equal(fs.existsSync(agentsFile), false);
});

test("updateAgentsMd creates parent directory if file does not exist", (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-learner-agents-"));
  const agentsFile = path.join(tmpDir, "nested", "dir", "AGENTS.md");

  t.after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const rules: LearnedRule[] = [
    { id: "1", tier: 2, toolName: "bash", pattern: "p1", recommendation: "Build with podman", sessionCount: 3, lastSeenTimestamp: 100 },
  ];

  const res = updateAgentsMd(agentsFile, rules, 10);
  assert.equal(res.updated, true);
  assert.equal(res.ruleCount, 1);
  assert.equal(fs.existsSync(agentsFile), true);
  const content = fs.readFileSync(agentsFile, "utf8");
  assert.match(content, /Build with podman/);
});
