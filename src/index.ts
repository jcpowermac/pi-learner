// src/index.ts
import * as fs from "node:fs";
import * as path from "node:path";
import type { PiLearnerConfig } from "./types.js";
import { readTraceSpans, resolveTraceFiles } from "./miner/trace-reader.js";
import { fetchCollectorSpans, mergeSpans } from "./miner/collector.js";
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
    playbooksPath: env.PI_LEARNER_PLAYBOOKS_PATH ?? env.PI_LEARNER_DB_PATH ?? path.resolve(process.cwd(), ".pi/playbooks.json"),
    collectorUrl: env.PI_LEARNER_COLLECTOR_URL || undefined,
  };
}

export default function (pi: any) {
  const config = resolveConfig();
  if (config.disabled) return;

  if (resolveTraceFiles(config.tracesPath).length === 0) {
    console.warn(
      `[pi-learner] No trace data at ${config.tracesPath} (or per-session traces-*.jsonl beside it); ` +
        "set PI_OTEL_EXPORTER=file (or PI_LEARNER_TRACES_PATH) so pi-otel writes traces."
    );
  }

  const circuitBreaker = new CircuitBreaker(config.circuitBreakerLimit);
  const playbookStore = new PlaybookStore(config.playbooksPath);
  let pendingTip: string | null = null;

  async function runLearningPass(): Promise<{ ruleCount: number }> {
    try {
      const localSpans = await readTraceSpans(config.tracesPath);
      let spans = localSpans;
      if (config.collectorUrl) {
        try {
          const collectorSpans = await fetchCollectorSpans(config.collectorUrl);
          spans = mergeSpans([localSpans, collectorSpans]);
        } catch (err) {
          console.warn(
            `[pi-learner] Collector fetch failed (${config.collectorUrl}); using local traces only: ` +
              (err instanceof Error ? err.message : err)
          );
        }
      }
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
      try {
        ctx?.ui?.notify?.("Analyzing traces...", "info");
        const res = await runLearningPass();
        ctx?.ui?.notify?.(`Learning pass complete: ${res.ruleCount} rule(s) promoted.`, "info");
      } catch (err) {
        console.warn("[pi-learner] Error in /learn command:", err);
      }
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
