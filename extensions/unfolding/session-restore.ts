import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ExtensionAPI, AgentSession } from "@earendil-works/pi-coding-agent";
import { createAgentSession, DefaultResourceLoader, SessionManager, getAgentDir } from "@earendil-works/pi-coding-agent";
import { readTask } from "./task-store.ts";
import { loadAgentSystemPrompt } from "./task-delegate.ts";
import { createChildTaskTools } from "./child-task-tools.ts";
import { makeTaskDelegateDefinition } from "./task-delegate-tool.ts";

export async function restoreChildSession(
  cwd: string,
  slug: string,
  activeSessions: Map<string, AgentSession>,
  pi: ExtensionAPI,
  postOutput: (lines: string) => void,
): Promise<AgentSession | null> {
  const task = readTask(cwd, slug);
  if (!task?.session_file || !existsSync(task.session_file)) return null;

  const shortRole = task.to.replace(/^unfolding-/, "");
  const rolesDir = resolve(new URL(import.meta.url).pathname, "..", "roles");
  const systemPrompt = loadAgentSystemPrompt(rolesDir, shortRole);
  if (!systemPrompt) return null;

  const tdderRoot = resolve(new URL(import.meta.url).pathname, "../../..");
  const loader = new DefaultResourceLoader({
    cwd,
    agentDir: getAgentDir(),
    noContextFiles: true,
    additionalExtensionPaths: [join(tdderRoot, "extensions")],
    systemPromptOverride: () => systemPrompt,
  });
  await loader.reload();

  const { session } = await createAgentSession({
    cwd,
    sessionManager: SessionManager.open(task.session_file, undefined, cwd),
    resourceLoader: loader,
    excludedToolNames: ["task_list", "task_read"],
    customTools: createChildTaskTools(
      cwd,
      slug,
      makeTaskDelegateDefinition(shortRole, activeSessions, pi, postOutput),
    ),
  });
  activeSessions.set(slug, session);
  return session;
}
