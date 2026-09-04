# Pi Trace-Driven Self-Improvement Extension (`pi-learner`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a trace-driven self-improvement extension for the Pi coding agent that mines `pi-otel` execution traces, applies Tier 1 parameter sanitization, maintains a budget-capped 30-line `.pi/AGENTS.md` (Tier 2), stores deep playbooks for JIT error recovery (Tier 3), and provides an in-flight circuit breaker.

**Architecture:** A TypeScript Pi extension package that parses `.pi/traces.jsonl` from `pi-otel`. It clusters failure-to-recovery trajectories using a strict "Rule of Three" gate ($\ge 3$ sessions), updates a 30-line capped `.pi/AGENTS.md` block with LRU pruning, intercepts in-flight tool errors to inject JIT recovery tips, and auto-corrects mechanical tool arguments in `tool_call`.

**Tech Stack:** Node.js 20+, TypeScript 5+, modern ES modules (`"type": "module"`), Node.js built-in test runner (`node:test`), `tsx`.

**Spec:** `docs/superpowers/specs/2026-09-04-pi-learner-design.md`

## Global Constraints
- Target Node.js 20+ and modern ES module syntax (`"type": "module"`).
- All event hook handlers MUST be defensively wrapped in `try/catch` blocks so learning logic never crashes or blocks Pi's interactive coding sessions.
- Enforce a strict **30-line hard cap (~300 tokens)** on the managed section in `.pi/AGENTS.md` with LRU eviction to prevent context explosion on local models.
- "Rule of Three" Gate: Patterns must be confirmed across $\ge 3$ distinct sessions before being promoted to persistent guidelines.
- Zero reverse proxy and zero external daemons: runs 100% in-process inside Pi.

---

### Task 1: Package Scaffolding & Configuration

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`
- Test: `tests/sanity.test.ts`

**Interfaces:**
- Consumes: None (root package setup).
- Produces: Runnable npm environment with TypeScript build and `node:test` runner.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/sanity.test.ts
import test from "node:test";
import assert from "node:assert/strict";

test("environment sanity check", () => {
  assert.equal(1 + 1, 2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/sanity.test.ts`
Expected: FAIL (missing node test target or node_modules not yet installed).

- [ ] **Step 3: Write minimal implementation**

```json
// package.json
{
  "name": "pi-learner",
  "version": "0.1.0",
  "description": "Trace-driven self-improvement extension for Pi coding agent",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "files": ["dist"],
  "scripts": {
    "build": "tsc",
    "test": "node --import tsx --test tests/**/*.test.ts",
    "prepublishOnly": "npm run build"
  },
  "pi": {
    "extensions": ["./dist/index.js"]
  },
  "keywords": ["pi", "opentelemetry", "self-improving", "agent", "learning"],
  "license": "MIT",
  "devDependencies": {
    "@types/node": "^20.14.0",
    "tsx": "^4.19.0",
    "typescript": "^5.5.0"
  }
}
```

```json
// tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "declaration": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

```text
// .gitignore
node_modules/
dist/
*.log
.pi/
```

Then run `npm install`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS with "environment sanity check".

- [ ] **Step 5: Commit**

```bash
git add package.json tsconfig.json .gitignore tests/sanity.test.ts
git commit -m "chore: scaffold pi-learner package and test harness"
```

---

### Task 2: Types & Bounded Trace Reader

**Files:**
- Create: `src/types.ts`
- Create: `src/miner/trace-reader.ts`
- Test: `tests/trace-reader.test.ts`

**Interfaces:**
- Consumes: JSON lines from `.pi/traces.jsonl`.
- Produces:
  - `ParsedSpan`: Interface for parsed OTel span records.
  - `TraceSession`: Grouped spans by traceId / session.
  - `readTraceSpans(filePath: string, maxBytes?: number): Promise<ParsedSpan[]>`
  - `groupSpansByTrace(spans: ParsedSpan[]): Map<string, ParsedSpan[]>`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/trace-reader.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL with "Cannot find module '../src/miner/trace-reader.js'".

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/types.ts
export interface ParsedSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind?: number;
  startTime?: [number, number] | number;
  endTime?: [number, number] | number;
  duration?: [number, number] | number;
  attributes: Record<string, any>;
  status?: { code: number };
  events?: any[];
}

export interface FailureRecoveryPair {
  traceId: string;
  sessionId?: string;
  toolName: string;
  failedInput?: any;
  errorSignature: string;
  successInput?: any;
  timestamp: number;
}

export interface LearnedRule {
  id: string;
  tier: 1 | 2 | 3;
  toolName: string;
  pattern: string;
  recommendation: string;
  sessionCount: number;
  lastSeenTimestamp: number;
}

export interface PiLearnerConfig {
  disabled: boolean;
  autoLearn: boolean;
  maxAgentsMdLines: number;
  ruleOfN: number;
  circuitBreakerLimit: number;
  tracesPath: string;
  agentsMdPath: string;
  playbooksPath: string;
}
```

```typescript
// src/miner/trace-reader.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS for trace-reader test.

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/miner/trace-reader.ts tests/trace-reader.test.ts
git commit -m "feat: implement types and bounded trace reader"
```

---

### Task 3: Trajectory Classifier & "Rule of Three" Promotion Gate

**Files:**
- Create: `src/miner/classifier.ts`
- Test: `tests/classifier.test.ts`

**Interfaces:**
- Consumes: `ParsedSpan[]` from Task 2.
- Produces:
  - `extractRecoveryPairs(spans: ParsedSpan[]): FailureRecoveryPair[]`
  - `classifyLearnedRules(pairs: FailureRecoveryPair[], ruleOfN?: number): LearnedRule[]`

- [ ] **Step 1: Write the failing test**

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL with "Cannot find module '../src/miner/classifier.js'".

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/miner/classifier.ts
import type { ParsedSpan, FailureRecoveryPair, LearnedRule } from "../types.js";
import { groupSpansByTrace } from "./trace-reader.js";

export function extractRecoveryPairs(spans: ParsedSpan[]): FailureRecoveryPair[] {
  const grouped = groupSpansByTrace(spans);
  const pairs: FailureRecoveryPair[] = [];

  for (const [traceId, traceSpans] of grouped.entries()) {
    let activeFailure: ParsedSpan | null = null;
    let sessionId: string | undefined;

    for (const span of traceSpans) {
      if (span.attributes?.["session.id"] && span.attributes["session.id"] !== "unknown") {
        sessionId = span.attributes["session.id"];
      }

      if (span.name.startsWith("tool:")) {
        const isError = Boolean(span.attributes?.["tool.is_error"]);
        const toolName = span.attributes?.["tool.name"] ?? span.name.replace("tool:", "");

        if (isError) {
          activeFailure = span;
        } else if (activeFailure && toolName === activeFailure.attributes?.["tool.name"]) {
          let failedInput: any;
          let successInput: any;

          try {
            failedInput = JSON.parse(activeFailure.attributes?.["tool.input.json"] ?? "{}");
          } catch {
            failedInput = activeFailure.attributes?.["tool.input.json"];
          }

          try {
            successInput = JSON.parse(span.attributes?.["tool.input.json"] ?? "{}");
          } catch {
            successInput = span.attributes?.["tool.input.json"];
          }

          const errorSig = failedInput?.command
            ? `command_fail:${failedInput.command.split(" ")[0]}`
            : failedInput?.path
            ? `path_fail:${failedInput.path}`
            : `${toolName}_error`;

          pairs.push({
            traceId,
            sessionId: sessionId ?? traceId,
            toolName,
            failedInput,
            errorSignature: errorSig,
            successInput,
            timestamp: Date.now(),
          });

          activeFailure = null;
        }
      }
    }
  }

  return pairs;
}

export function classifyLearnedRules(pairs: FailureRecoveryPair[], ruleOfN = 3): LearnedRule[] {
  const clusters = new Map<string, { pairs: FailureRecoveryPair[]; sessions: Set<string> }>();

  for (const pair of pairs) {
    const key = `${pair.toolName}::${pair.errorSignature}`;
    const entry = clusters.get(key) ?? { pairs: [], sessions: new Set() };
    entry.pairs.push(pair);
    entry.sessions.add(pair.sessionId ?? pair.traceId);
    clusters.set(key, entry);
  }

  const promoted: LearnedRule[] = [];

  for (const [key, cluster] of clusters.entries()) {
    if (cluster.sessions.size >= ruleOfN) {
      const latestPair = cluster.pairs[cluster.pairs.length - 1];
      const toolName = latestPair.toolName;

      let tier: 1 | 2 | 3 = 2;
      let recommendation = "";

      // Tier 1: Mechanical parameter formatting
      if (typeof latestPair.failedInput?.path === "string" && latestPair.failedInput.path.startsWith("./")) {
        tier = 1;
        recommendation = "strip_leading_dotslash";
      } else if (latestPair.successInput?.command) {
        // Tier 2: Workflow guideline
        tier = 2;
        recommendation = `When running \`${latestPair.failedInput?.command}\`, use \`${latestPair.successInput.command}\` instead.`;
      } else {
        // Tier 3: Deep error recovery
        tier = 3;
        recommendation = JSON.stringify(latestPair.successInput);
      }

      promoted.push({
        id: key,
        tier,
        toolName,
        pattern: latestPair.errorSignature,
        recommendation,
        sessionCount: cluster.sessions.size,
        lastSeenTimestamp: latestPair.timestamp,
      });
    }
  }

  return promoted;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS for classifier tests.

- [ ] **Step 5: Commit**

```bash
git add src/miner/classifier.ts tests/classifier.test.ts
git commit -m "feat: implement trajectory pairing and Rule of Three classifier"
```

---

### Task 4: Tier 1 Parameter Sanitizer & In-Flight Circuit Breaker

**Files:**
- Create: `src/guards/sanitizer.ts`
- Create: `src/guards/circuit-breaker.ts`
- Test: `tests/guards.test.ts`

**Interfaces:**
- Consumes: Tool inputs from Pi's `tool_call` event.
- Produces:
  - `sanitizeToolInput(toolName: string, input: any): { modified: boolean, input: any }`
  - `CircuitBreaker`: Class with `recordToolCall(toolName: string, input: any): void`, `recordToolResult(toolName: string, isError: boolean): void`, and `shouldBlock(toolName: string, input: any): { block: boolean, reason?: string }`

- [ ] **Step 1: Write the failing test**

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL with "Cannot find module '../src/guards/sanitizer.js'".

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/guards/sanitizer.ts
export function sanitizeToolInput(toolName: string, input: any): { modified: boolean; input: any } {
  if (!input || typeof input !== "object") {
    return { modified: false, input };
  }

  let modified = false;
  const cloned = { ...input };

  // File path tools: strip redundant leading ./
  if (typeof cloned.path === "string" && cloned.path.startsWith("./") && cloned.path.length > 2) {
    cloned.path = cloned.path.slice(2);
    modified = true;
  }

  // File path tools: strip trailing slashes on files
  if (typeof cloned.path === "string" && cloned.path.endsWith("/") && cloned.path.length > 1) {
    cloned.path = cloned.path.replace(/\/+$/, "");
    modified = true;
  }

  return { modified, input: cloned };
}
```

```typescript
// src/guards/circuit-breaker.ts
export class CircuitBreaker {
  private threshold: number;
  private consecutiveFailures = new Map<string, number>();
  private lastCallSignature: string | null = null;

  constructor(threshold = 2) {
    this.threshold = threshold;
  }

  private makeSignature(toolName: string, input: any): string {
    const serialized = typeof input === "object" ? JSON.stringify(input) : String(input ?? "");
    return `${toolName}:${serialized}`;
  }

  recordToolCall(toolName: string, input: any): void {
    this.lastCallSignature = this.makeSignature(toolName, input);
  }

  recordToolResult(toolName: string, isError: boolean): void {
    if (!this.lastCallSignature) return;

    if (isError) {
      const current = this.consecutiveFailures.get(this.lastCallSignature) ?? 0;
      this.consecutiveFailures.set(this.lastCallSignature, current + 1);
    } else {
      this.consecutiveFailures.delete(this.lastCallSignature);
    }
  }

  shouldBlock(toolName: string, input: any): { block: boolean; reason?: string } {
    const sig = this.makeSignature(toolName, input);
    const count = this.consecutiveFailures.get(sig) ?? 0;

    if (count >= this.threshold) {
      return {
        block: true,
        reason: `[pi-learner circuit-breaker] Tool '${toolName}' with identical arguments failed ${count} times consecutively. Pivot to a different approach.`,
      };
    }

    return { block: false };
  }

  reset(): void {
    this.consecutiveFailures.clear();
    this.lastCallSignature = null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS for guards tests.

- [ ] **Step 5: Commit**

```bash
git add src/guards/sanitizer.ts src/guards/circuit-breaker.ts tests/guards.test.ts
git commit -m "feat: implement Tier 1 parameter sanitizer and circuit breaker"
```

---

### Task 5: Tier 2 Capped AGENTS.md Store & LRU Eviction

**Files:**
- Create: `src/store/agents-md.ts`
- Test: `tests/agents-md.test.ts`

**Interfaces:**
- Consumes: `LearnedRule[]` from Task 3.
- Produces:
  - `updateAgentsMd(filePath: string, rules: LearnedRule[], maxLines?: number): { updated: boolean, ruleCount: number, lines: number }`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/agents-md.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { updateAgentsMd } from "../src/store/agents-md.js";
import type { LearnedRule } from "../src/types.js";

test("updateAgentsMd updates delimited block and enforces hard line cap with LRU eviction", (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-learner-agents-"));
  const agentsFile = path.join(tmpDir, "AGENTS.md");

  t.after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  fs.writeFileSync(agentsFile, "# Developer Guidelines\nCustom human rules.\n", "utf8");

  const rules: LearnedRule[] = [
    { id: "1", tier: 2, toolName: "bash", pattern: "p1", recommendation: "Rule 1", sessionCount: 3, lastSeenTimestamp: 100 },
    { id: "2", tier: 2, toolName: "bash", pattern: "p2", recommendation: "Rule 2", sessionCount: 4, lastSeenTimestamp: 200 },
    { id: "3", tier: 2, toolName: "bash", pattern: "p3", recommendation: "Rule 3", sessionCount: 5, lastSeenTimestamp: 300 },
  ];

  // Set line cap to 2 rules
  const res = updateAgentsMd(agentsFile, rules, 2);
  assert.equal(res.updated, true);
  assert.equal(res.ruleCount, 2);

  const content = fs.readFileSync(agentsFile, "utf8");
  assert.match(content, /Developer Guidelines/); // Preserved human content
  assert.match(content, /<!-- pi-learner:start -->/);
  assert.match(content, /Rule 3/); // Most recent
  assert.match(content, /Rule 2/);
  assert.doesNotMatch(content, /Rule 1/); // Evicted via LRU!
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL with "Cannot find module '../src/store/agents-md.js'".

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/store/agents-md.ts
import * as fs from "node:fs";
import * as path from "node:path";
import type { LearnedRule } from "../types.js";

const START_MARKER = "<!-- pi-learner:start -->";
const END_MARKER = "<!-- pi-learner:end -->";

export function updateAgentsMd(
  filePath: string,
  rules: LearnedRule[],
  maxLines = 30
): { updated: boolean; ruleCount: number; lines: number } {
  const tier2Rules = rules.filter((r) => r.tier === 2);
  if (tier2Rules.length === 0) {
    return { updated: false, ruleCount: 0, lines: 0 };
  }

  // Sort by lastSeenTimestamp descending (newest first for LRU retention)
  const sorted = [...tier2Rules].sort((a, b) => b.lastSeenTimestamp - a.lastSeenTimestamp);

  // Deduplicate recommendations
  const uniqueRecommendations: string[] = [];
  const seen = new Set<string>();

  for (const rule of sorted) {
    const text = rule.recommendation.trim();
    if (!seen.has(text)) {
      seen.add(text);
      uniqueRecommendations.push(text);
    }
  }

  // Cap lines to maxLines
  const capped = uniqueRecommendations.slice(0, maxLines);

  const blockLines = [
    START_MARKER,
    "### Learned Repository Guidelines (Auto-generated by pi-learner)",
    ...capped.map((r) => `- ${r}`),
    END_MARKER,
  ];
  const blockText = blockLines.join("\n");

  let existing = "";
  if (fs.existsSync(filePath)) {
    existing = fs.readFileSync(filePath, "utf8");
  } else {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  let newContent: string;
  const startIdx = existing.indexOf(START_MARKER);
  const endIdx = existing.indexOf(END_MARKER);

  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    newContent = existing.slice(0, startIdx).trimEnd() + "\n\n" + blockText + "\n" + existing.slice(endIdx + END_MARKER.length).trimStart();
  } else {
    newContent = existing.trim() ? `${existing.trim()}\n\n${blockText}\n` : `${blockText}\n`;
  }

  // Atomic write via temp file
  const tmpPath = `${filePath}.tmp.${Date.now()}`;
  fs.writeFileSync(tmpPath, newContent, "utf8");
  fs.renameSync(tmpPath, filePath);

  return { updated: true, ruleCount: capped.length, lines: capped.length };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS for agents-md tests.

- [ ] **Step 5: Commit**

```bash
git add src/store/agents-md.ts tests/agents-md.test.ts
git commit -m "feat: implement Tier 2 capped AGENTS.md store with LRU eviction"
```

---

### Task 6: Tier 3 Playbook Store & JIT Injection

**Files:**
- Create: `src/store/db.ts`
- Test: `tests/db.test.ts`

**Interfaces:**
- Consumes: Tier 3 `LearnedRule[]` and query errors.
- Produces:
  - `PlaybookStore`: Class with `saveRules(rules: LearnedRule[]): void`, `findRecoveryTip(toolName: string, errorSnippet: string): string | null`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/db.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { PlaybookStore } from "../src/store/db.js";

test("PlaybookStore saves deep rules and retrieves matching recovery tip", (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-learner-db-"));
  const dbFile = path.join(tmpDir, "playbooks.json");

  t.after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const store = new PlaybookStore(dbFile);
  store.saveRules([
    {
      id: "p1",
      tier: 3,
      toolName: "bash",
      pattern: "command_fail:podman",
      recommendation: "Use --platform linux/arm64 flag",
      sessionCount: 3,
      lastSeenTimestamp: Date.now(),
    },
  ]);

  const tip = store.findRecoveryTip("bash", "podman build error platform unsupported");
  assert.ok(tip);
  assert.match(tip, /--platform linux\/arm64/);

  const noMatch = store.findRecoveryTip("read", "file not found");
  assert.equal(noMatch, null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL with "Cannot find module '../src/store/db.js'".

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/store/db.ts
import * as fs from "node:fs";
import * as path from "node:path";
import type { LearnedRule } from "../types.js";

export class PlaybookStore {
  private filePath: string;
  private memoryCache: Map<string, LearnedRule> = new Map();

  constructor(filePath: string) {
    this.filePath = filePath;
    this.load();
  }

  private load(): void {
    if (!fs.existsSync(this.filePath)) {
      return;
    }
    try {
      const data = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
      if (Array.isArray(data)) {
        for (const rule of data) {
          this.memoryCache.set(rule.id, rule);
        }
      }
    } catch {
      // Ignore corrupt DB file
    }
  }

  saveRules(rules: LearnedRule[]): void {
    const tier3Rules = rules.filter((r) => r.tier === 3 || r.tier === 2);
    for (const rule of tier3Rules) {
      this.memoryCache.set(rule.id, rule);
    }

    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const tmpPath = `${this.filePath}.tmp.${Date.now()}`;
    const serialized = JSON.stringify(Array.from(this.memoryCache.values()), null, 2);
    fs.writeFileSync(tmpPath, serialized, "utf8");
    fs.renameSync(tmpPath, this.filePath);
  }

  findRecoveryTip(toolName: string, errorSnippet: string): string | null {
    const normalized = errorSnippet.toLowerCase();

    for (const rule of this.memoryCache.values()) {
      if (rule.toolName === toolName) {
        const patternTerm = rule.pattern.replace(/.*?:/, "").toLowerCase();
        if (normalized.includes(patternTerm) || patternTerm.includes(normalized)) {
          return rule.recommendation;
        }
      }
    }

    return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS for db tests.

- [ ] **Step 5: Commit**

```bash
git add src/store/db.ts tests/db.test.ts
git commit -m "feat: implement Tier 3 playbook store and JIT error matching"
```

---

### Task 7: Pi Extension Entrypoint, Hooks, and `/learn` Command

**Files:**
- Create: `src/index.ts`
- Test: `tests/extension.test.ts`

**Interfaces:**
- Consumes: All components from Tasks 2-6 and Pi `ExtensionAPI`.
- Produces: Default export function `(pi: ExtensionAPI): void`.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/extension.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import extensionFactory from "../src/index.js";

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
    for (const h of list) {
      await h(payload, ctx ?? {});
    }
  }
}

test("extension registers hooks, handles tool sanitization, and runs /learn command", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-learner-ext-"));
  const tracesPath = path.join(tmpDir, "traces.jsonl");
  const agentsMdPath = path.join(tmpDir, "AGENTS.md");
  const playbooksPath = path.join(tmpDir, "playbooks.json");

  t.after(() => {
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

  // Run /learn command
  const learnHandler = pi.commands.get("learn");
  assert.ok(learnHandler);
  const notifyMock = { notify: (_msg: string) => {} };
  await learnHandler("", { ui: notifyMock });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL with "Cannot find module '../src/index.js'".

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/index.ts
import * as path from "node:path";
import type { PiLearnerConfig } from "./types.js";
import { readTraceSpans } from "./miner/trace-reader.js";
import { extractRecoveryPairs, classifyLearnedRules } from "./miner/classifier.js";
import { sanitizeToolInput } from "./guards/sanitizer.js";
import { CircuitBreaker } from "./guards/circuit-breaker.js";
import { updateAgentsMd } from "./store/agents-md.js";
import { PlaybookStore } from "./store/db.js";

export function resolveConfig(): PiLearnerConfig {
  const env = process.env;
  return {
    disabled: env.PI_LEARNER_DISABLED === "true" || env.PI_LEARNER_DISABLED === "1",
    autoLearn: env.PI_LEARNER_AUTO !== "false" && env.PI_LEARNER_AUTO !== "0",
    maxAgentsMdLines: parseInt(env.PI_LEARNER_MAX_AGENTS_MD_LINES ?? "30", 10),
    ruleOfN: parseInt(env.PI_LEARNER_RULE_OF_N ?? "3", 10),
    circuitBreakerLimit: parseInt(env.PI_LEARNER_CIRCUIT_BREAKER_LIMIT ?? "2", 10),
    tracesPath: env.PI_LEARNER_TRACES_PATH ?? path.resolve(process.cwd(), ".pi/traces.jsonl"),
    agentsMdPath: env.PI_LEARNER_AGENTS_MD_PATH ?? path.resolve(process.cwd(), ".pi/AGENTS.md"),
    playbooksPath: env.PI_LEARNER_PLAYBOOKS_PATH ?? path.resolve(process.cwd(), ".pi/playbooks.json"),
  };
}

export default function (pi: any) {
  const config = resolveConfig();
  if (config.disabled) return;

  const circuitBreaker = new CircuitBreaker(config.circuitBreakerLimit);
  const playbookStore = new PlaybookStore(config.playbooksPath);
  let pendingTip: string | null = null;

  async function runLearningPass(): Promise<{ ruleCount: number }> {
    try {
      const spans = await readTraceSpans(config.tracesPath);
      if (spans.length === 0) return { ruleCount: 0 };

      const pairs = extractRecoveryPairs(spans);
      const rules = classifyLearnedRules(pairs, config.ruleOfN);

      if (rules.length > 0) {
        updateAgentsMd(config.agentsMdPath, rules, config.maxAgentsMdLines);
        playbookStore.saveRules(rules);
      }

      return { ruleCount: rules.length };
    } catch (err) {
      console.warn("[pi-learner] Error running learning pass:", err);
      return { ruleCount: 0 };
    }
  }

  // Tier 1: In-flight parameter sanitization & Circuit Breaker
  pi.on("tool_call", async (event: any) => {
    try {
      if (!event) return;

      // Tier 1 Sanitization
      const sanitized = sanitizeToolInput(event.toolName, event.input);
      if (sanitized.modified) {
        event.input = sanitized.input;
      }

      // Circuit Breaker Check
      const blockCheck = circuitBreaker.shouldBlock(event.toolName, event.input);
      if (blockCheck.block) {
        return { block: true, reason: blockCheck.reason };
      }

      circuitBreaker.recordToolCall(event.toolName, event.input);
    } catch (err) {
      console.warn("[pi-learner] Error in tool_call:", err);
    }
  });

  // Tier 3: In-flight error matching & JIT tip queueing
  pi.on("tool_result", async (event: any) => {
    try {
      if (!event) return;
      const isError = Boolean(event.isError);
      circuitBreaker.recordToolResult(event.toolName, isError);

      if (isError) {
        const contentStr = Array.isArray(event.content)
          ? event.content.map((c: any) => c.text ?? "").join(" ")
          : String(event.content ?? "");
        const tip = playbookStore.findRecoveryTip(event.toolName, contentStr);
        if (tip) {
          pendingTip = `💡 Learner Tip: ${tip}`;
        }
      }
    } catch (err) {
      console.warn("[pi-learner] Error in tool_result:", err);
    }
  });

  // Inject JIT recovery tip into context on turn start
  pi.on("before_agent_start", async () => {
    try {
      if (pendingTip) {
        const message = {
          role: "user",
          content: pendingTip,
        };
        pendingTip = null;
        return { message };
      }
    } catch (err) {
      console.warn("[pi-learner] Error in before_agent_start:", err);
    }
  });

  // Register /learn command
  pi.registerCommand?.("learn", {
    description: "Analyze pi-otel traces and update .pi/AGENTS.md guidelines",
    handler: async (_args: string, ctx: any) => {
      ctx?.ui?.notify?.("Analyzing traces...", "info");
      const res = await runLearningPass();
      ctx?.ui?.notify?.(`Learning pass complete: ${res.ruleCount} rule(s) promoted.`, "info");
    },
  });

  // Auto-run on session shutdown
  pi.on("session_shutdown", async () => {
    try {
      if (config.autoLearn) {
        await runLearningPass();
      }
    } catch (err) {
      console.warn("[pi-learner] Error in session_shutdown:", err);
    }
  });

  return { runLearningPass, circuitBreaker, playbookStore };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS for extension tests.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts tests/extension.test.ts
git commit -m "feat: implement extension entrypoint, lifecycle hooks, and /learn command"
```

---

### Task 8: Build, README, and End-to-End Verification

**Files:**
- Create: `README.md`
- Test: Full build and all test suites

**Interfaces:**
- Consumes: All modules from Tasks 1-7.
- Produces: Production build in `dist/` and complete documentation.

- [ ] **Step 1: Write README.md**

```markdown
# pi-learner

Trace-driven self-improvement extension for the [Pi coding agent](https://github.com/earendil-works/pi-coding-agent).

Mines runtime execution traces generated by [`pi-otel`](https://github.com/jcpowermac/pi-otel) (`.pi/traces.jsonl`) to detect recurring tool failures, prevent thrashing loops, and distill verified winning trajectories into actionable project guidelines.

## Features
- **3-Tier Zero-Bloat Architecture**:
  - **Tier 1 (Code Sanitizer - 0 tokens)**: Auto-corrects mechanical tool arguments (e.g. leading `./` in paths) in `tool_call`.
  - **Tier 2 (Capped Playbook - ~300 tokens fixed)**: Maintains a hard 30-line ceiling in `.pi/AGENTS.md` with LRU eviction for local models (Qwen 27B, etc.).
  - **Tier 3 (JIT Deep Playbooks - 0 tokens until hit)**: Injects transient 2-line recovery tips only when specific matching tool errors occur.
- **Rule of Three Gate**: Only promotes patterns verified across $\ge 3$ distinct sessions.
- **In-Flight Circuit Breaker**: Stops tool retry loops if identical arguments fail twice consecutively.

## Installation
```bash
pi install ~/Development/pi-learner
# or test ad-hoc:
pi -e ~/Development/pi-learner
```

## Commands
- `/learn`: Manually trigger trace ingestion and guideline updates.

## Configuration
Set environment variables:
- `PI_LEARNER_DISABLED`: Set to `true` to disable
- `PI_LEARNER_AUTO`: Auto-learn on session shutdown (default: `true`)
- `PI_LEARNER_MAX_AGENTS_MD_LINES`: Maximum lines for `.pi/AGENTS.md` block (default: `30`)
- `PI_LEARNER_RULE_OF_N`: Minimum sessions for promotion (default: `3`)
- `PI_LEARNER_CIRCUIT_BREAKER_LIMIT`: Consecutive failures before blocking (default: `2`)
```

- [ ] **Step 2: Build project and verify compilation**

Run: `npm run build`
Expected: Compiles clean to `dist/index.js` and `dist/index.d.ts` without errors.

- [ ] **Step 3: Run full test suite**

Run: `npm test`
Expected: All test suites PASS.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: add README with installation and configuration guide"
```
