import { existsSync } from "node:fs";
import { join } from "node:path";

export {
  buildProjectTree,
  findProjectRoot,
  parsePom,
  resolveCurrentProject,
  stripInternalFields,
  type PomInfo,
  type ProjectNode,
} from "./vendor/maven-project-tree.ts";

export function detectRunner(projectRoot: string): string {
  return existsSync(join(projectRoot, "mvnw")) ? "./mvnw" : "mvn";
}
