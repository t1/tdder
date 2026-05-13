import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Persists raw Maven output under `<projectRoot>/target/pi/maven-logs/`. */
export function saveRawLog(projectRoot: string, action: string, output: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const filename = `${timestamp}-${action}.log`;
  const dir = join(projectRoot, "target", "pi", "maven-logs");
  mkdirSync(dir, { recursive: true });
  const logPath = join(dir, filename);
  writeFileSync(logPath, output, "utf8");
  // Return a project-relative path for the result payload
  return join("target", "pi", "maven-logs", filename);
}
