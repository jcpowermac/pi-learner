import type { ParsedSpan } from "../types.js";

// otel-gui query API: GET {base}/api/traces -> [{traceId, ...}]
//                    GET {base}/api/traces/:id -> {traceId, spans: {<spanId>: {...}}}

function mapCollectorSpan(raw: any): ParsedSpan | null {
  if (!raw || !raw.traceId || !raw.spanId || !raw.name) return null;
  return {
    traceId: raw.traceId,
    spanId: raw.spanId,
    parentSpanId: raw.parentSpanId,
    name: raw.name,
    kind: raw.kind,
    attributes: raw.attributes ?? {},
    status: raw.status ? { code: raw.status.code } : undefined,
    events: raw.events ?? [],
  };
}

export function mapCollectorTrace(raw: any): ParsedSpan[] {
  const spans = raw?.spans;
  if (!spans || typeof spans !== "object") return [];
  return Object.values(spans)
    .map(mapCollectorSpan)
    .filter((s): s is ParsedSpan => s !== null);
}

// Union multiple span sources, deduped by traceId+spanId.
export function mergeSpans(sources: ParsedSpan[][]): ParsedSpan[] {
  const seen = new Set<string>();
  const out: ParsedSpan[] = [];
  for (const spans of sources) {
    for (const s of spans) {
      const key = `${s.traceId}:${s.spanId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(s);
    }
  }
  return out;
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

export async function fetchCollectorSpans(
  baseUrl: string,
  timeoutMs = 5000,
  maxTraces = 50
): Promise<ParsedSpan[]> {
  const base = baseUrl.replace(/\/+$/, "");
  const listRes = await fetchWithTimeout(`${base}/api/traces`, timeoutMs);
  if (!listRes.ok) throw new Error(`collector /api/traces returned HTTP ${listRes.status}`);
  const list = (await listRes.json()) as any[];
  const ids = (Array.isArray(list) ? list : [])
    .slice(0, maxTraces)
    .map((t) => t?.traceId)
    .filter(Boolean);

  const perTrace = await Promise.all(
    ids.map(async (id: string) => {
      try {
        const r = await fetchWithTimeout(`${base}/api/traces/${encodeURIComponent(id)}`, timeoutMs);
        if (!r.ok) return [];
        return mapCollectorTrace(await r.json());
      } catch {
        return [];
      }
    })
  );
  return perTrace.flat();
}
