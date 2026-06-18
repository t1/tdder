import type { Model } from "@earendil-works/pi-ai";
import type { ExtensionAPI, AgentSession, AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { createSnapshotCommit, ensureGitRepoWithHead, isWorkspaceDirty } from "./git-task-state.ts";
import { createTask, readTask, updateTaskStatus, type Task } from "./task-store.ts";
import { installTruncationRecovery, streamChildSession, waitForChildDecision } from "./task-delegate.ts";
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
  model?: Model<any>;
  authStorage?: AuthStorage;
  modelRegistry?: ModelRegistry;
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
  model,
  authStorage,
  modelRegistry,
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
    model,
    authStorage,
    modelRegistry,
  });

  if (existing) {
    updateTaskStatus(cwd, slug, "in_progress");
  } else {
    const gitBootstrap = ensureGitRepoWithHead(cwd);
    if (gitBootstrap.initializedRepo) {
      postOutput("  ℹ unfolding initialized a local git repository for rollback support");
    }
    const baseSha = gitBootstrap.head;
    const snapshotSha = isWorkspaceDirty(cwd) ? createSnapshotCommit(cwd) : undefined;
    createTask(cwd, {
      slug,
      from,
      to: role,
      body,
      parent_slug,
      session_id: session.sessionId,
      session_file: session.sessionFile,
      base_sha: baseSha,
      snapshot_sha: snapshotSha,
    });
  }

  signal?.addEventListener("abort", () => { session.abort().catch(() => {}); });
  const unsubscribeTruncationRecovery = installTruncationRecovery(session, cwd, slug);
  session.prompt(initialMessage).catch((err: unknown) => {
    const stack = err instanceof Error ? err.stack : String(err);
    console.error(`[unfolding] child session for task "${slug}" failed:`, stack);
  });

  const stream = onUpdate ? streamChildSession(session, shortRole, slug, onUpdate, { sessionFile: session.sessionFile }) : undefined;
  const outcome = await waitForChildDecision(
    async () => readTask(cwd, slug),
    (_status: string, blocked_reason?: string) => {
      stream?.append(`  ⏸ blocked: ${blocked_reason ?? "(no reason given)"}`);
    },
    undefined,
    signal,
  );
  unsubscribeTruncationRecovery();
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
