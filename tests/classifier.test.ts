// tests/classifier.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { extractRecoveryPairs, classifyLearnedRules } from "../src/miner/classifier.js";
import type { ParsedSpan } from "../src/types.js";

test("extractRecoveryPairs pairs failed tool span with subsequent successful tool span", () => {
  const spans: ParsedSpan[] = [
    {
      traceId: "t1",
      spanId: "s1",
      name: "tool:bash",
      attributes: {
        "tool.name": "bash",
        "tool.is_error": true,
        "tool.input.json": JSON.stringify({ command: "npm test" }),
      },
    },
    {
      traceId: "t1",
      spanId: "s2",
      name: "tool:bash",
      attributes: {
        "tool.name": "bash",
        "tool.is_error": false,
        "tool.input.json": JSON.stringify({ command: "npm test -- --runInBand" }),
      },
    },
  ];

  const pairs = extractRecoveryPairs(spans);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].toolName, "bash");
  assert.equal(pairs[0].failedInput.command, "npm test");
  assert.equal(pairs[0].successInput.command, "npm test -- --runInBand");
  assert.equal(pairs[0].errorSignature, "command_fail:npm test");
});

test("extractRecoveryPairs differentiates subcommands instead of collapsing to base binary", () => {
  const spans: ParsedSpan[] = [
    {
      traceId: "t1",
      spanId: "s1",
      name: "tool:bash",
      attributes: {
        "tool.name": "bash",
        "tool.is_error": true,
        "tool.input.json": JSON.stringify({ command: "npm test" }),
      },
    },
    {
      traceId: "t1",
      spanId: "s2",
      name: "tool:bash",
      attributes: {
        "tool.name": "bash",
        "tool.is_error": false,
        "tool.input.json": JSON.stringify({ command: "npm test --verbose" }),
      },
    },
    {
      traceId: "t1",
      spanId: "s3",
      name: "tool:bash",
      attributes: {
        "tool.name": "bash",
        "tool.is_error": true,
        "tool.input.json": JSON.stringify({ command: "npm install express" }),
      },
    },
    {
      traceId: "t1",
      spanId: "s4",
      name: "tool:bash",
      attributes: {
        "tool.name": "bash",
        "tool.is_error": false,
        "tool.input.json": JSON.stringify({ command: "npm install --legacy-peer-deps express" }),
      },
    },
  ];

  const pairs = extractRecoveryPairs(spans);
  assert.equal(pairs.length, 2);
  assert.equal(pairs[0].errorSignature, "command_fail:npm test");
  assert.equal(pairs[1].errorSignature, "command_fail:npm install");
});

test("extractRecoveryPairs does not pair when commands do not share base binary", () => {
  const spans: ParsedSpan[] = [
    {
      traceId: "t1",
      spanId: "s1",
      name: "tool:bash",
      attributes: {
        "tool.name": "bash",
        "tool.is_error": true,
        "tool.input.json": JSON.stringify({ command: "npm test" }),
      },
    },
    {
      traceId: "t1",
      spanId: "s2",
      name: "tool:bash",
      attributes: {
        "tool.name": "bash",
        "tool.is_error": false,
        "tool.input.json": JSON.stringify({ command: "git status" }),
      },
    },
  ];

  const pairs = extractRecoveryPairs(spans);
  assert.equal(pairs.length, 0);
});

test("extractRecoveryPairs discards activeFailure if more than 3 intermediate tool spans pass", () => {
  const createBashError = (): ParsedSpan => ({
    traceId: "t1",
    spanId: "s0",
    name: "tool:bash",
    attributes: { "tool.name": "bash", "tool.is_error": true, "tool.input.json": JSON.stringify({ command: "npm test" }) },
  });
  const createIntermediate = (id: string): ParsedSpan => ({
    traceId: "t1",
    spanId: id,
    name: "tool:read",
    attributes: { "tool.name": "read", "tool.is_error": false, "tool.input.json": JSON.stringify({ path: "file.ts" }) },
  });
  const createBashSuccess = (): ParsedSpan => ({
    traceId: "t1",
    spanId: "s_rec",
    name: "tool:bash",
    attributes: { "tool.name": "bash", "tool.is_error": false, "tool.input.json": JSON.stringify({ command: "npm test --runInBand" }) },
  });

  // 3 intermediate tool spans -> Still pairs
  const spans3 = [createBashError(), createIntermediate("i1"), createIntermediate("i2"), createIntermediate("i3"), createBashSuccess()];
  assert.equal(extractRecoveryPairs(spans3).length, 1);

  // 4 intermediate tool spans -> Discarded (> 3)
  const spans4 = [createBashError(), createIntermediate("i1"), createIntermediate("i2"), createIntermediate("i3"), createIntermediate("i4"), createBashSuccess()];
  assert.equal(extractRecoveryPairs(spans4).length, 0);
});

test("extractRecoveryPairs resolves root sessionId upfront from trace spans", () => {
  const spans: ParsedSpan[] = [
    {
      traceId: "t1",
      spanId: "s_root",
      name: "agent_run",
      attributes: { "session.id": "session-xyz" },
    },
    {
      traceId: "t1",
      spanId: "s1",
      name: "tool:bash",
      attributes: { "tool.name": "bash", "tool.is_error": true, "tool.input.json": JSON.stringify({ command: "pytest" }) },
    },
    {
      traceId: "t1",
      spanId: "s2",
      name: "tool:bash",
      attributes: { "tool.name": "bash", "tool.is_error": false, "tool.input.json": JSON.stringify({ command: "pytest -m unit" }) },
    },
  ];

  const pairs = extractRecoveryPairs(spans);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].sessionId, "session-xyz");
});

test("classifyLearnedRules enforces Rule of Three threshold", () => {
  const pairFactory = (traceId: string) => ({
    traceId,
    toolName: "bash",
    errorSignature: "npm test failed",
    failedInput: { command: "npm test" },
    successInput: { command: "npm test -- --runInBand" },
    timestamp: Date.now(),
  });

  // Only 2 sessions -> Not promoted
  const rules2 = classifyLearnedRules([pairFactory("t1"), pairFactory("t2")], 3);
  assert.equal(rules2.length, 0);

  // 3 sessions -> Promoted!
  const rules3 = classifyLearnedRules([pairFactory("t1"), pairFactory("t2"), pairFactory("t3")], 3);
  assert.equal(rules3.length, 1);
  assert.equal(rules3[0].sessionCount, 3);
  assert.match(rules3[0].recommendation, /runInBand/);
});

test("classifyLearnedRules classifies Tier 1 leading dotslash path", () => {
  const pair = (traceId: string) => ({
    traceId,
    toolName: "read",
    errorSignature: "path_fail:./src/index.ts",
    failedInput: { path: "./src/index.ts" },
    successInput: { path: "src/index.ts" },
    timestamp: Date.now(),
  });

  const rules = classifyLearnedRules([pair("t1"), pair("t2"), pair("t3")], 3);
  assert.equal(rules.length, 1);
  assert.equal(rules[0].tier, 1);
  assert.equal(rules[0].recommendation, "strip_leading_dotslash");
});

test("classifyLearnedRules classifies Tier 3 when no command is present", () => {
  const pair = (traceId: string) => ({
    traceId,
    toolName: "custom",
    errorSignature: "custom_error",
    failedInput: { arg: "foo" },
    successInput: { arg: "bar", mode: "safe" },
    timestamp: Date.now(),
  });

  const rules = classifyLearnedRules([pair("t1"), pair("t2"), pair("t3")], 3);
  assert.equal(rules.length, 1);
  assert.equal(rules[0].tier, 3);
  assert.match(rules[0].recommendation, /safe/);
});
