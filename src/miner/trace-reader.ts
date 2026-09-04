import * as fs from "node:fs";
import * as readline from "node:readline";
import type { ParsedSpan } from "../types.js";

export async function readTraceSpans(filePath: string, maxBytes = 5 * 1024 * 1024): Promise<ParsedSpan[]> {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  const stat = fs.statSync(filePath);
  const startOffset = Math.max(0, stat.size - maxBytes);

  const stream = fs.createReadStream(filePath, {
    start: startOffset,
    encoding: "utf8",
  });

  const rl = readline.createInterface({
    input: stream,
    crlfDelay: Infinity,
  });

  const spans: ParsedSpan[] = [];
  let isFirstLine = startOffset > 0;

  for await (const line of rl) {
    if (isFirstLine) {
      isFirstLine = false;
      continue; // Skip potentially truncated first line when reading from middle
    }
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as ParsedSpan;
      if (parsed && parsed.traceId && parsed.spanId && parsed.attributes) {
        spans.push(parsed);
      }
    } catch {
      // Ignore corrupt lines
    }
  }

  return spans;
}

export function groupSpansByTrace(spans: ParsedSpan[]): Map<string, ParsedSpan[]> {
  const map = new Map<string, ParsedSpan[]>();
  for (const span of spans) {
    const list = map.get(span.traceId) ?? [];
    list.push(span);
    map.set(span.traceId, list);
  }
  return map;
}
