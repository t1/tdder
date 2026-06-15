import type { ExtensionAPI, AgentSession } from "@earendil-works/pi-coding-agent";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { createTask, readTask, updateTaskStatus, type Task } from "./task-store.ts";
import { streamChildSession, waitForChildDecision } from "./task-delegate.ts";
import { buildChildInitialMessage, createChildAgentSession, type NestedDelegateToolFactory } from "./session-common.ts";

export interface ChildSessionRunResult {
  session: AgentSession;
  outcome: "finished" | "blocked" | "aborted";
}

export interface StartChildSessionParams {
  cwd: string;
  from: string;
  role: string;
  slug: string;
  body: string;
  parent_slug?: string;
  activeSessions: Map<string, AgentSession>;
  pi: ExtensionAPI;
  postOutput: (lines: string) => void;
  nestedDelegateToolFactory: NestedDelegateToolFactory;
  signal?: AbortSignal;
  onUpdate?: any;
}

export async function startChildSession({
  cwd,
  from,
  role,
  slug,
  body,
  parent_slug,
  activeSessions,
  pi,
  postOutput,
  nestedDelegateToolFactory,
  signal,
  onUpdate,
}: StartChildSessionParams): Promise<ChildSessionRunResult> {
  const existing = readTask(cwd, slug);
  const initialMessage = buildChildInitialMessage(body, existing?.resume_message);

  const { session, shortRole } = await createChildAgentSession({
    cwd,
    role,
    slug,
    sessionManager: SessionManager.create(cwd),
    activeSessions,
    pi,
    postOutput,
    nestedDelegateToolFactory,
  });

  if (existing) {
    updateTaskStatus(cwd, slug, "in_progress");
  } else {
    createTask(cwd, {
      slug,
      from,
      to: role,
      body,
      parent_slug,
      session_id: session.sessionId,
      session_file: session.sessionFile,
    });
  }

  signal?.addEventListener("abort", () => { session.abort().catch(() => {}); });
  session.prompt(initialMessage).catch((err: unknown) => {
    const stack = err instanceof Error ? err.stack : String(err);
    console.error(`[unfolding] child session for task "${slug}" failed:`, stack);
  });

  const stream = onUpdate ? streamChildSession(session, shortRole, slug, onUpdate) : undefined;
  const outcome = await waitForChildDecision(
    async () => readTask(cwd, slug),
    (_status: string, blocked_reason?: string) => {
      stream?.append(`  ⏸ blocked: ${blocked_reason ?? "(no reason given)"}`);
    },
    undefined,
    signal,
  );
  stream?.unsubscribe();
  const stats = session.getSessionStats();
  const costLine = `  💰 $${stats.cost.toFixed(4)} (↑${stats.tokens.input} ↓${stats.tokens.output})`;
  if (stream) postOutput(stream.getLines() + "\n" + costLine);
  else postOutput(costLine);

  return { session, outcome };
}

export function readTaskSnapshot(cwd: string, slug: string): Task | null {
  return readTask(cwd, slug);
}
