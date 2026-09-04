import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { readTraceSpans, groupSpansByTrace } from "../src/miner/trace-reader.js";

test("readTraceSpans parses JSONL spans from file", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-learner-test-"));
  const traceFile = path.join(tmpDir, "traces.jsonl");

  t.after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const span1 = {
    traceId: "t1",
    spanId: "s1",
    name: "tool:bash",
    attributes: { "tool.name": "bash", "tool.is_error": true },
  };
  const span2 = {
    traceId: "t1",
    spanId: "s2",
    name: "tool:bash",
    attributes: { "tool.name": "bash", "tool.is_error": false },
  };

  fs.writeFileSync(traceFile, `${JSON.stringify(span1)}\n${JSON.stringify(span2)}\n`, "utf8");

  const spans = await readTraceSpans(traceFile);
  assert.equal(spans.length, 2);
  assert.equal(spans[0].traceId, "t1");
  assert.equal(spans[0].attributes["tool.is_error"], true);

  const grouped = groupSpansByTrace(spans);
  assert.equal(grouped.get("t1")?.length, 2);
});
