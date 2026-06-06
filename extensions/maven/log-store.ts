import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Persists raw Maven output under `<projectRoot>/target/pi/maven-logs/`. Returns a path relative to projectRoot. */
export function saveRawLog(projectRoot: string, action: string, output: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const filename = `${timestamp}-${action}.log`;
  const relPath = join("target", "pi", "maven-logs", filename);
  const absPath = join(projectRoot, relPath);
  mkdirSync(join(projectRoot, "target", "pi", "maven-logs"), { recursive: true });
  writeFileSync(absPath, output, "utf8");
  return relPath;
}
