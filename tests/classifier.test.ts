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
