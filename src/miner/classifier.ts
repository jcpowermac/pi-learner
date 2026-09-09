// src/miner/classifier.ts
import type { ParsedSpan, FailureRecoveryPair, LearnedRule } from "../types.js";
import { groupSpansByTrace } from "./trace-reader.js";

export function extractRecoveryPairs(spans: ParsedSpan[]): FailureRecoveryPair[] {
  const grouped = groupSpansByTrace(spans);
  const pairs: FailureRecoveryPair[] = [];

  for (const [traceId, traceSpans] of grouped.entries()) {
    const rootSessionId = traceSpans.find(
      (s) => s.attributes?.["session.id"] && s.attributes["session.id"] !== "unknown"
    )?.attributes?.["session.id"];
    const sessionId = rootSessionId ?? traceId;

    let activeFailure: ParsedSpan | null = null;
    let intermediateToolCount = 0;

    for (const span of traceSpans) {
      if (span.name.startsWith("tool:")) {
        const isError = Boolean(span.attributes?.["tool.is_error"]);
        const toolName = span.attributes?.["tool.name"] ?? span.name.replace("tool:", "");

        if (isError) {
          activeFailure = span;
          intermediateToolCount = 0;
        } else if (activeFailure) {
          const failedToolName =
            activeFailure.attributes?.["tool.name"] ?? activeFailure.name.replace("tool:", "");
          let isMatch = toolName === failedToolName;

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

          if (
            isMatch &&
            typeof failedInput?.command === "string" &&
            typeof successInput?.command === "string"
          ) {
            const failedBinary = failedInput.command.trim().split(/\s+/)[0];
            const successBinary = successInput.command.trim().split(/\s+/)[0];
            if (failedBinary && successBinary && failedBinary !== successBinary) {
              isMatch = false;
            }
          }

          if (isMatch) {
            let errorSig: string;
            if (typeof failedInput?.command === "string") {
              const cmdTokens = failedInput.command.trim().split(/\s+/).filter(Boolean);
              const cmdVerb = cmdTokens.slice(0, 2).join(" ");
              errorSig = cmdVerb ? `command_fail:${cmdVerb}` : "command_fail";
            } else if (typeof failedInput?.path === "string") {
              // ponytail: bare "path_fail" — per-path signatures never repeat
              // across sessions, so they could never reach the rule-of-3 gate.
              errorSig = "path_fail";
            } else {
              errorSig = `${toolName}_error`;
            }

            pairs.push({
              traceId,
              sessionId,
              toolName,
              failedInput,
              errorSignature: errorSig,
              successInput,
              timestamp: Date.now(),
            });

            activeFailure = null;
            intermediateToolCount = 0;
          } else {
            intermediateToolCount++;
            if (intermediateToolCount > 3) {
              activeFailure = null;
            }
          }
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
