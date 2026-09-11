import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { PiLearnerConfig } from "./types.js";

export const CONFIG_FILE_NAME = "pi-learner.json";

/** PI agent config dir: PI_CODING_AGENT_DIR override, else ~/.pi/agent. */
export function piAgentDir(): string {
  return process.env.PI_CODING_AGENT_DIR ?? path.join(os.homedir(), ".pi", "agent");
}

export function configFilePath(): string {
  return path.join(piAgentDir(), CONFIG_FILE_NAME);
}

interface RawConfig {
  otel?: Record<string, unknown>;
  learner?: Partial<PiLearnerConfig>;
}

/** Read the shared pi-learner.json config; missing/invalid file yields {}. */
export function readConfigFile(): RawConfig {
  try {
    const parsed = JSON.parse(fs.readFileSync(configFilePath(), "utf8"));
    if (parsed && typeof parsed === "object") return parsed as RawConfig;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(
        `[pi-learner] Failed to read config ${configFilePath()}: ${err instanceof Error ? err.message : err}`
      );
    }
  }
  return {};
}

/** The "learner" section, or undefined when the file has none. */
export function readLearnerConfig(): Partial<PiLearnerConfig> | undefined {
  return readConfigFile().learner;
}
