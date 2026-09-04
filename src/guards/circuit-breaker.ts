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
