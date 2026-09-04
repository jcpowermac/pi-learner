// tests/guards.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeToolInput } from "../src/guards/sanitizer.js";
import { CircuitBreaker } from "../src/guards/circuit-breaker.js";

test("sanitizeToolInput strips leading ./ from file path arguments", () => {
  const res = sanitizeToolInput("read", { path: "./src/index.ts" });
  assert.equal(res.modified, true);
  assert.equal(res.input.path, "src/index.ts");
});

test("sanitizeToolInput handles non-object or clean paths gracefully", () => {
  assert.equal(sanitizeToolInput("read", null).modified, false);
  assert.equal(sanitizeToolInput("read", "raw-string").modified, false);
  assert.equal(sanitizeToolInput("read", { command: "ls" }).modified, false);

  const clean = sanitizeToolInput("read", { path: "src/index.ts" });
  assert.equal(clean.modified, false);

  const trailingSlash = sanitizeToolInput("read", { path: "src/dir/" });
  assert.equal(trailingSlash.modified, true);
  assert.equal(trailingSlash.input.path, "src/dir");
});

test("CircuitBreaker trips after 2 consecutive identical failures", () => {
  const cb = new CircuitBreaker(2);

  cb.recordToolCall("bash", { command: "invalid-cmd" });
  cb.recordToolResult("bash", true);

  assert.equal(cb.shouldBlock("bash", { command: "invalid-cmd" }).block, false);

  cb.recordToolCall("bash", { command: "invalid-cmd" });
  cb.recordToolResult("bash", true);

  const blockCheck = cb.shouldBlock("bash", { command: "invalid-cmd" });
  assert.equal(blockCheck.block, true);
  assert.match(blockCheck.reason ?? "", /failed 2 times consecutively/);
});

test("CircuitBreaker success resets failure count and different args do not block", () => {
  const cb = new CircuitBreaker(2);

  cb.recordToolCall("bash", { command: "cmd-1" });
  cb.recordToolResult("bash", true);

  // Different command should not be blocked
  assert.equal(cb.shouldBlock("bash", { command: "cmd-2" }).block, false);

  // Success on cmd-1 resets failure count
  cb.recordToolCall("bash", { command: "cmd-1" });
  cb.recordToolResult("bash", false);

  assert.equal(cb.shouldBlock("bash", { command: "cmd-1" }).block, false);

  // Reset method
  cb.recordToolCall("bash", { command: "cmd-fail" });
  cb.recordToolResult("bash", true);
  cb.recordToolCall("bash", { command: "cmd-fail" });
  cb.recordToolResult("bash", true);
  assert.equal(cb.shouldBlock("bash", { command: "cmd-fail" }).block, true);

  cb.reset();
  assert.equal(cb.shouldBlock("bash", { command: "cmd-fail" }).block, false);
});

test("CircuitBreaker clears lastCallSignature after recording result so it does not linger", () => {
  const cb = new CircuitBreaker(2);

  cb.recordToolCall("bash", { command: "failing-cmd" });
  cb.recordToolResult("bash", true); // failure 1

  // Second tool result without a tool call does not increment failure count
  cb.recordToolResult("bash", true);
  assert.equal(cb.shouldBlock("bash", { command: "failing-cmd" }).block, false);

  // New tool call with failure increments to 2 and blocks
  cb.recordToolCall("bash", { command: "failing-cmd" });
  cb.recordToolResult("bash", true); // failure 2
  assert.equal(cb.shouldBlock("bash", { command: "failing-cmd" }).block, true);
});
