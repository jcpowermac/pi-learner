// tests/db.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { PlaybookStore } from "../src/store/db.js";

test("PlaybookStore saves deep rules and retrieves matching recovery tip", (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-learner-db-"));
  const dbFile = path.join(tmpDir, "playbooks.json");

  t.after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const store = new PlaybookStore(dbFile);
  store.saveRules([
    {
      id: "p1",
      tier: 3,
      toolName: "bash",
      pattern: "command_fail:podman",
      recommendation: "Use --platform linux/arm64 flag",
      sessionCount: 3,
      lastSeenTimestamp: Date.now(),
    },
  ]);

  const tip = store.findRecoveryTip("bash", "podman build error platform unsupported");
  assert.ok(tip);
  assert.match(tip, /--platform linux\/arm64/);

  const noMatch = store.findRecoveryTip("read", "file not found");
  assert.equal(noMatch, null);
});

test("PlaybookStore handles corrupt file and empty inputs gracefully", (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-learner-db-corrupt-"));
  const dbFile = path.join(tmpDir, "corrupt.json");

  t.after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  fs.writeFileSync(dbFile, "not-valid-json{{{", "utf8");
  const store = new PlaybookStore(dbFile);

  assert.equal(store.findRecoveryTip("bash", ""), null);
  assert.equal(store.findRecoveryTip("bash", null as any), null);

  // Saving works and replaces corrupt file
  store.saveRules([
    {
      id: "p2",
      tier: 2,
      toolName: "npm",
      pattern: "install_fail",
      recommendation: "Run npm install --legacy-peer-deps",
      sessionCount: 3,
      lastSeenTimestamp: 500,
    },
    {
      id: "p3",
      tier: 1, // Tier 1 should be filtered out
      toolName: "read",
      pattern: "path_fix",
      recommendation: "strip",
      sessionCount: 3,
      lastSeenTimestamp: 500,
    },
  ]);

  const tip = store.findRecoveryTip("npm", "install_fail occurred");
  assert.equal(tip, "Run npm install --legacy-peer-deps");
  assert.equal(store.findRecoveryTip("read", "path_fix"), null);
});
