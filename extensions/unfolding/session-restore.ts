import { existsSync } from "node:fs";
import type { Model } from "@earendil-works/pi-ai";
import type { ExtensionAPI, AgentSession, AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { readTask } from "./task-store.ts";
import { createChildAgentSession, type NestedDelegateToolFactory } from "./session-common.ts";
import type { CostLedger } from "./cost-ledger.ts";

export async function restoreChildSession(
  cwd: string,
  slug: string,
  activeSessions: Map<string, AgentSession>,
  pi: ExtensionAPI,
  postOutput: (lines: string) => void,
  nestedDelegateToolFactory: NestedDelegateToolFactory,
  model?: Model<any>,
  authStorage?: AuthStorage,
  modelRegistry?: ModelRegistry,
  costLedger?: CostLedger,
): Promise<{ session: AgentSession; shutdown: () => Promise<void> } | null> {
  const task = readTask(cwd, slug);
  if (!task?.session_file || !existsSync(task.session_file)) return null;

  const { session, shutdown } = await createChildAgentSession({
    cwd,
    role: task.to,
    slug,
    sessionManager: SessionManager.open(task.session_file, undefined, cwd),
    activeSessions,
    pi,
    postOutput,
    nestedDelegateToolFactory,
    model,
    authStorage,
    modelRegistry,
    costLedger,
  });
  return { session, shutdown };
}
