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
