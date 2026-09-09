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

test("readTraceSpans falls back to per-session traces-*.jsonl files", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-learner-test-"));
  const configuredPath = path.join(tmpDir, "traces.jsonl"); // does not exist

  t.after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const make = (traceId: string, spanId: string, isError: boolean) =>
    JSON.stringify({ traceId, spanId, name: "tool:bash", attributes: { "tool.is_error": isError } });
  fs.writeFileSync(path.join(tmpDir, "traces-aaaaaaaa.jsonl"), `${make("t1", "s1", true)}\n`, "utf8");
  fs.writeFileSync(path.join(tmpDir, "traces-bbbbbbbb.jsonl"), `${make("t2", "s2", false)}\n`, "utf8");
  fs.writeFileSync(path.join(tmpDir, "unrelated.jsonl"), `${make("t3", "s3", false)}\n`, "utf8");

  const spans = await readTraceSpans(configuredPath);
  assert.equal(spans.length, 2, "reads per-session files only, not unrelated jsonl");
  assert.deepEqual(spans.map((s) => s.traceId).sort(), ["t1", "t2"]);

  // Exact file wins over the fallback
  fs.writeFileSync(configuredPath, `${make("t9", "s9", false)}\n`, "utf8");
  const exact = await readTraceSpans(configuredPath);
  assert.equal(exact.length, 1);
  assert.equal(exact[0].traceId, "t9");
});
