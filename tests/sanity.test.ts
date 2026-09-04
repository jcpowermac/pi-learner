// tests/sanity.test.ts
import test from "node:test";
import assert from "node:assert/strict";

test("environment sanity check", () => {
  assert.equal(1 + 1, 2);
});
