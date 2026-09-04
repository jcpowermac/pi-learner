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
          if (rule && rule.id) {
            this.memoryCache.set(rule.id, rule);
          }
        }
      }
    } catch {
      // Ignore corrupt DB file
    }
  }

  saveRules(rules: LearnedRule[]): void {
    const targetRules = rules.filter((r) => r.tier === 3 || r.tier === 2);
    for (const rule of targetRules) {
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
    if (!errorSnippet || typeof errorSnippet !== "string") {
      return null;
    }
    const normalized = errorSnippet.toLowerCase();

    for (const rule of this.memoryCache.values()) {
      if (rule.toolName === toolName && typeof rule?.pattern === "string") {
        const patternTerm = rule.pattern.replace(/.*?:/, "").toLowerCase();
        if (patternTerm && (normalized.includes(patternTerm) || patternTerm.includes(normalized))) {
          return rule.recommendation;
        }
      }
    }

    return null;
  }
}
