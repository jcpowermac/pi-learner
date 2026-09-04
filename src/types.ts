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
