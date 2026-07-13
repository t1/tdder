import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import hygiene from "../index.ts";

function fakePi() {
  const handlers = new Map<string, Function[]>();
  return {
    on(event: string, handler: Function) {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    },
    registerMessageRenderer() {},
    __handlers: handlers,
  } as any;
}

function beforeAgentStartHandler(pi: any) {
  return pi.__handlers.get("before_agent_start")?.[0];
}

describe("hygiene skill reminders", () => {
  it("reminds to load project-hygiene when no skills are loaded", async () => {
    const pi = fakePi();
    hygiene(pi);
    const result = await beforeAgentStartHandler(pi)({
      systemPrompt: "base",
      systemPromptOptions: { cwd: "/tmp", skills: [] },
    });
    expect(result.systemPrompt).toContain("Load the `project-hygiene` skill");
    expect(result.message.customType).toBe("hygiene-injected-prompts");
  });

  it("does not remind when all detectable skills are already loaded", async () => {
    const pi = fakePi();
    hygiene(pi);
    const result = await beforeAgentStartHandler(pi)({
      systemPrompt: "base",
      systemPromptOptions: {
        cwd: "/tmp",
        skills: [{ name: "project-hygiene" }, { name: "java" }, { name: "github-safety" }],
      },
    });
    expect(result).toBeUndefined();
  });

  it("reminds to load java when .java files are present and the java skill is not loaded", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hygiene-java-"));
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src", "Foo.java"), "class Foo {}");
    const pi = fakePi();
    hygiene(pi);
    const result = await beforeAgentStartHandler(pi)({
      systemPrompt: "base",
      systemPromptOptions: { cwd: dir, skills: [{ name: "project-hygiene" }] },
    });
    expect(result.systemPrompt).toContain("Load the `java` skill");
  });

  it("reminds to load github-safety when .git/config references github.com", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hygiene-git-"));
    mkdirSync(join(dir, ".git"), { recursive: true });
    writeFileSync(join(dir, ".git", "config"), '[remote "origin"]\n\turl = git@github.com:foo/bar.git\n');
    const pi = fakePi();
    hygiene(pi);
    const result = await beforeAgentStartHandler(pi)({
      systemPrompt: "base",
      systemPromptOptions: { cwd: dir, skills: [{ name: "project-hygiene" }, { name: "java" }] },
    });
    expect(result.systemPrompt).toContain("Load the `github-safety` skill");
  });
});
