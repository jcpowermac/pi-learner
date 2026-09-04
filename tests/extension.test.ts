// tests/extension.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import extensionFactory, { resolveConfig } from "../src/index.js";

class MockExtensionAPI {
  handlers = new Map<string, Function[]>();
  commands = new Map<string, Function>();

  on(event: string, handler: Function) {
    const list = this.handlers.get(event) ?? [];
    list.push(handler);
    this.handlers.set(event, list);
  }

  registerCommand(name: string, def: { handler: Function }) {
    this.commands.set(name, def.handler);
  }

  async emit(event: string, payload: any, ctx?: any) {
    const list = this.handlers.get(event) ?? [];
    let result: any;
    for (const h of list) {
      result = await h(payload, ctx ?? {});
    }
    return result;
  }
}

test("resolveConfig resolves default environment values", () => {
  const cfg = resolveConfig();
  assert.equal(cfg.disabled, false);
  assert.equal(cfg.autoLearn, true);
  assert.equal(cfg.maxAgentsMdLines, 30);
  assert.equal(cfg.ruleOfN, 3);
  assert.equal(cfg.circuitBreakerLimit, 2);
});

test("resolveConfig respects PI_LEARNER_DB_PATH fallback for playbooksPath", () => {
  process.env.PI_LEARNER_DB_PATH = "/tmp/custom-playbooks.json";
  const cfg = resolveConfig();
  assert.equal(cfg.playbooksPath, "/tmp/custom-playbooks.json");
  delete process.env.PI_LEARNER_DB_PATH;
});

test("extension registers hooks, handles tool sanitization, and runs /learn command", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-learner-ext-"));
  const tracesPath = path.join(tmpDir, "traces.jsonl");
  const agentsMdPath = path.join(tmpDir, "AGENTS.md");
  const playbooksPath = path.join(tmpDir, "playbooks.json");

  t.after(() => {
    delete process.env.PI_LEARNER_TRACES_PATH;
    delete process.env.PI_LEARNER_AGENTS_MD_PATH;
    delete process.env.PI_LEARNER_PLAYBOOKS_PATH;
    delete process.env.PI_LEARNER_DB_PATH;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  process.env.PI_LEARNER_TRACES_PATH = tracesPath;
  process.env.PI_LEARNER_AGENTS_MD_PATH = agentsMdPath;
  process.env.PI_LEARNER_PLAYBOOKS_PATH = playbooksPath;

  const pi = new MockExtensionAPI();
  extensionFactory(pi as any);

  assert.ok(pi.commands.has("learn"));

  // Verify parameter sanitization
  const toolCallEvent = { toolName: "read", input: { path: "./src/file.ts" } };
  await pi.emit("tool_call", toolCallEvent);
  assert.equal(toolCallEvent.input.path, "src/file.ts");

  // Run /learn command with empty traces
  const learnHandler = pi.commands.get("learn");
  assert.ok(learnHandler);
  let notifiedMessage = "";
  const notifyMock = { notify: (msg: string) => { notifiedMessage = msg; } };
  await learnHandler("", { ui: notifyMock });
  assert.match(notifiedMessage, /Learning pass complete: 0 rule\(s\) promoted/);
});

test("extension blocks tool_call when circuit breaker trips", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-learner-ext-"));
  t.after(() => {
    delete process.env.PI_LEARNER_TRACES_PATH;
    delete process.env.PI_LEARNER_AGENTS_MD_PATH;
    delete process.env.PI_LEARNER_PLAYBOOKS_PATH;
    delete process.env.PI_LEARNER_CIRCUIT_BREAKER_LIMIT;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  process.env.PI_LEARNER_TRACES_PATH = path.join(tmpDir, "traces.jsonl");
  process.env.PI_LEARNER_AGENTS_MD_PATH = path.join(tmpDir, "AGENTS.md");
  process.env.PI_LEARNER_PLAYBOOKS_PATH = path.join(tmpDir, "playbooks.json");
  process.env.PI_LEARNER_CIRCUIT_BREAKER_LIMIT = "2";

  const pi = new MockExtensionAPI();
  extensionFactory(pi as any);

  // Failure 1
  await pi.emit("tool_call", { toolName: "bash", input: { command: "failing-cmd" } });
  await pi.emit("tool_result", { toolName: "bash", isError: true, content: "err" });

  // Failure 2
  await pi.emit("tool_call", { toolName: "bash", input: { command: "failing-cmd" } });
  await pi.emit("tool_result", { toolName: "bash", isError: true, content: "err" });

  // Call 3 should be blocked!
  const blockResult = await pi.emit("tool_call", { toolName: "bash", input: { command: "failing-cmd" } });
  assert.ok(blockResult);
  assert.equal(blockResult.block, true);
  assert.match(blockResult.reason, /failed 2 times consecutively/);
});

test("extension queues and injects JIT tip via before_agent_start on matching error", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-learner-ext-"));
  const playbooksPath = path.join(tmpDir, "playbooks.json");
  t.after(() => {
    delete process.env.PI_LEARNER_TRACES_PATH;
    delete process.env.PI_LEARNER_AGENTS_MD_PATH;
    delete process.env.PI_LEARNER_PLAYBOOKS_PATH;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // Pre-seed a playbook rule
  fs.writeFileSync(
    playbooksPath,
    JSON.stringify([
      {
        id: "podman-fix",
        tier: 3,
        toolName: "bash",
        pattern: "command_fail:podman",
        recommendation: "Run with --platform linux/arm64",
        sessionCount: 3,
        lastSeenTimestamp: Date.now(),
      },
    ]),
    "utf8"
  );

  process.env.PI_LEARNER_TRACES_PATH = path.join(tmpDir, "traces.jsonl");
  process.env.PI_LEARNER_AGENTS_MD_PATH = path.join(tmpDir, "AGENTS.md");
  process.env.PI_LEARNER_PLAYBOOKS_PATH = playbooksPath;

  const pi = new MockExtensionAPI();
  extensionFactory(pi as any);

  // Emit a tool_result that matches the pattern
  await pi.emit("tool_result", {
    toolName: "bash",
    isError: true,
    content: [{ type: "text", text: "podman build error unsupported arch" }],
  });

  // Next before_agent_start should inject tip
  const startResult = await pi.emit("before_agent_start", {});
  assert.ok(startResult?.message);
  assert.match(startResult.message.content, /Run with --platform linux\/arm64/);

  // Second before_agent_start should not repeat tip
  const secondResult = await pi.emit("before_agent_start", {});
  assert.equal(secondResult, undefined);
});

test("extension respects PI_LEARNER_DISABLED=true", () => {
  process.env.PI_LEARNER_DISABLED = "true";
  const pi = new MockExtensionAPI();
  extensionFactory(pi as any);

  delete process.env.PI_LEARNER_DISABLED;
  assert.equal(pi.handlers.size, 0);
  assert.equal(pi.commands.size, 0);
});
