import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export function isQuarkusProject(dir: string): boolean {
  const pomPath = resolve(dir, "pom.xml");
  if (existsSync(pomPath)) {
    try {
      if (readFileSync(pomPath, "utf8").includes("quarkus-maven-plugin")) return true;
    } catch {
      // ignore unreadable files and fall through to other build files
    }
  }

  for (const gradleFile of ["build.gradle", "build.gradle.kts"]) {
    const gradlePath = resolve(dir, gradleFile);
    if (!existsSync(gradlePath)) continue;
    try {
      if (readFileSync(gradlePath, "utf8").includes("quarkus")) return true;
    } catch {
      // ignore unreadable files and keep checking
    }
  }

  return false;
}
