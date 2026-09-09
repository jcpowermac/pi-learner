import test from "node:test";
import assert from "node:assert/strict";
import * as http from "node:http";
import { mapCollectorTrace, mergeSpans, fetchCollectorSpans } from "../src/miner/collector.js";
import type { ParsedSpan } from "../src/types.js";

// Fixture shaped like otel-gui GET /api/traces/:id (real response shape).
const otelGuiTrace = {
  traceId: "ba8dc268",
  rootSpanName: "agent_run",
  serviceName: "pi-coding-agent",
  spans: {
    "6ffdbc513856a02c": {
      traceId: "ba8dc268",
      spanId: "6ffdbc513856a02c",
      parentSpanId: "f9e1517d",
      name: "gen_ai.chat",
      kind: 1,
      startTimeUnixNano: "1788958835938000000",
      endTimeUnixNano: "1788958840417939004",
      attributes: { "gen_ai.request.model": "test-model" },
      events: [],
      links: [],
      status: { code: 0, message: "" },
    },
    "4801aaa9b6cb27b4": {
      traceId: "ba8dc268",
      spanId: "4801aaa9b6cb27b4",
      parentSpanId: "f9e1517d",
      name: "tool:ctx_execute_file",
      kind: 1,
      attributes: { "tool.is_error": true, "tool.name": "ctx_execute_file", "tool.input.json": "{}" },
      status: { code: 2, message: "" },
    },
    notASpan: null, // must be filtered out
  },
};

test("mapCollectorTrace maps otel-gui spans to ParsedSpan and filters invalid entries", () => {
  const spans = mapCollectorTrace(otelGuiTrace);
  assert.equal(spans.length, 2);
  const tool = spans.find((s) => s.name === "tool:ctx_execute_file");
  assert.ok(tool);
  assert.equal(tool!.traceId, "ba8dc268");
  assert.equal(tool!.spanId, "4801aaa9b6cb27b4");
  assert.equal(tool!.attributes["tool.is_error"], true);
  assert.equal(tool!.status?.code, 2);
  assert.equal(mapCollectorTrace({}).length, 0);
  assert.equal(mapCollectorTrace(null).length, 0);
});

test("mergeSpans unions sources and dedupes by traceId+spanId", () => {
  const a: ParsedSpan = { traceId: "t1", spanId: "s1", name: "x", attributes: {} };
  const b: ParsedSpan = { traceId: "t1", spanId: "s2", name: "y", attributes: {} };
  const dupOfA: ParsedSpan = { traceId: "t1", spanId: "s1", name: "x-dup", attributes: {} };
  const c: ParsedSpan = { traceId: "t2", spanId: "s1", name: "z", attributes: {} }; // same spanId, different trace: kept
  const merged = mergeSpans([[a, b], [dupOfA, c]]);
  assert.equal(merged.length, 3);
  assert.equal(merged.find((s) => s.spanId === "s1" && s.traceId === "t1")!.name, "x");
  assert.ok(merged.includes(c));
});

test("fetchCollectorSpans pulls list + per-trace spans from an otel-gui-shaped API", async (t) => {
  const server = http.createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.url === "/api/traces") {
      res.end(JSON.stringify([{ traceId: "ba8dc268", spanCount: 2 }, { traceId: "missing" }]));
    } else if (req.url === "/api/traces/ba8dc268") {
      res.end(JSON.stringify(otelGuiTrace));
    } else if (req.url === "/api/traces/missing") {
      res.statusCode = 404;
      res.end("{}");
    } else {
      res.statusCode = 404;
      res.end("{}");
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  t.after(() => server.close());

  const spans = await fetchCollectorSpans(`http://127.0.0.1:${port}`);
  assert.equal(spans.length, 2);
  assert.ok(spans.every((s) => s.traceId === "ba8dc268")); // 404 trace contributes nothing
});

test("fetchCollectorSpans rejects when collector is unreachable", async () => {
  await assert.rejects(
    () => fetchCollectorSpans("http://127.0.0.1:1", 500),
    /collector|fetch|abort|ECONNREFUSED/i
  );
});
