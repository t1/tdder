import { detectRunner } from "./project-info.ts";

export function parseClasspath(raw: string): string[] {
  return raw ? raw.split(":") : [];
}

const SKILL_PREFIX = "META-INF/.agent/skills/";

export async function extractSkillsFromJar(jarPath: string): Promise<Map<string, string>> {
  const { spawnSync } = await import("node:child_process");
  const result = new Map<string, string>();

  const list = spawnSync("unzip", ["-l", jarPath], { encoding: "utf8" });
  if (list.status !== 0) return result;

  const skillEntries = list.stdout
    .split("\n")
    .map((l) => l.trim().split(/\s+/).pop() ?? "")
    .filter((name) => name.startsWith(SKILL_PREFIX) && name.endsWith(".md"));

  for (const entry of skillEntries) {
    const read = spawnSync("unzip", ["-p", jarPath, entry], { encoding: "utf8" });
    if (read.status === 0)
      result.set(entry.slice(SKILL_PREFIX.length), read.stdout);
  }

  return result;
}

export async function loadJarSkills(projectRoot: string, signal?: AbortSignal): Promise<string | null> {
  const { existsSync, mkdtempSync, writeFileSync, mkdirSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");

  if (!existsSync(join(projectRoot, "pom.xml"))) return null;

  const classpath = await resolveClasspath(projectRoot, signal);
  const skills = new Map<string, string>();

  for (const jar of classpath) {
    if (signal?.aborted) return null;
    const found = await extractSkillsFromJar(jar);
    for (const [name, content] of found) skills.set(name, content);
  }

  if (skills.size === 0) return null;

  const outDir = mkdtempSync(join(tmpdir(), "pi-jar-skills-"));
  for (const [name, content] of skills)
    writeFileSync(join(outDir, name), content, "utf8");

  return outDir;
}

async function resolveClasspath(projectRoot: string, signal?: AbortSignal): Promise<string[]> {
  const { spawnSync } = await import("node:child_process");
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");

  const outFile = join(mkdtempSync(join(tmpdir(), "pi-cp-")), "classpath.txt");
  const runner = detectRunner(projectRoot);
  const result = spawnSync(
    runner,
    ["dependency:build-classpath", "-q", `-Dmdep.outputFile=${outFile}`],
    { cwd: projectRoot, encoding: "utf8", signal },
  );

  if (result.status !== 0) return [];
  return parseClasspath(readFileSync(outFile, "utf8").trim());
}
