import type { Model } from "@earendil-works/pi-ai";
import type { ExtensionAPI, AgentSession, AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { existsSync } from "node:fs";
import { createSnapshotCommit, ensureGitRepoWithHead, isWorkspaceDirty } from "./git-task-state.ts";
import { createTask, readTask, recreateTaskSession, updateTaskStatus, type Task } from "./task-store.ts";
import {
  childSessionFailureBlockedReason,
  installCheckpointRecovery,
  streamChildSession,
  waitForChildDecision,
} from "./task-delegate.ts";
import { buildChildInitialMessage, createChildAgentSession, type NestedDelegateToolFactory } from "./session-common.ts";
import type { ChildOutputDetails } from "./child-output.ts";

export interface ChildSessionRunResult {
  session: AgentSession;
  outcome: "finished" | "blocked" | "aborted" | "recreate";
  recreateMessage?: string;
  finalSnapshot?: string;
  finalOutputDetails?: ChildOutputDetails;
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
  parentSignal?: AbortSignal;
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
  parentSignal,
  onUpdate,
  model,
  authStorage,
  modelRegistry,
}: StartChildSessionParams): Promise<ChildSessionRunResult> {
  const existing = readTask(cwd, slug);
  return startChildSessionAttempt({
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
    parentSignal,
    onUpdate,
    model,
    authStorage,
    modelRegistry,
    existing,
  });
}

async function startChildSessionAttempt({
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
  parentSignal,
  onUpdate,
  model,
  authStorage,
  modelRegistry,
  existing,
}: StartChildSessionParams & { existing: Task | null }): Promise<ChildSessionRunResult> {
  const recreating = !!existing?.recreate_message;
  const resuming = !recreating && !!(existing?.session_file && existsSync(existing.session_file));
  const initialMessage = resuming || recreating
    ? buildChildInitialMessage(body, existing?.resume_message ?? existing?.recreate_message ?? "continue")
    : buildChildInitialMessage(body);
  const sessionManager = resuming
    ? SessionManager.open(existing!.session_file!)
    : SessionManager.create(cwd);

  const { session, shortRole, shutdown } = await createChildAgentSession({
    cwd,
    role,
    slug,
    sessionManager,
    activeSessions,
    pi,
    postOutput,
    nestedDelegateToolFactory,
    model,
    authStorage,
    modelRegistry,
  });

  let wasLocallyAborted = signal?.aborted === true || parentSignal?.aborted === true;
  let stream: ReturnType<typeof streamChildSession> | undefined;
  let onAbort: (() => void) | undefined;
  let observedTerminalAbort = false;
  let unsubscribeAbortObserver: (() => void) | undefined;
  let checkpointRecovery: ReturnType<typeof installCheckpointRecovery> | undefined;
  let taskPrepared = false;
  try {
    if (existing && recreating) {
      recreateTaskSession(cwd, slug, session.sessionId, session.sessionFile, existing.recreate_message!);
    } else if (existing) {
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
    taskPrepared = true;

    stream = onUpdate ? streamChildSession(session, shortRole, slug, onUpdate, {
      sessionFile: session.sessionFile,
      getContextUsage: () => session.getContextUsage(),
      getCost: () => session.getSessionStats().cost,
    }) : undefined;
    onAbort = () => {
      wasLocallyAborted = true;
      session.abort().catch(() => {});
    };
    signal?.addEventListener("abort", onAbort);
    parentSignal?.addEventListener("abort", onAbort);
    unsubscribeAbortObserver = session.subscribe((event: any) => {
      if (event?.type === "message_end" && event.message?.role === "assistant" && event.message?.stopReason === "aborted") {
        observedTerminalAbort = true;
      }
    });
    checkpointRecovery = installCheckpointRecovery(session, cwd, slug, {
      onRecoveryNote: stream?.append,
    });
    session.prompt(initialMessage).catch((err: unknown) => {
      const stack = err instanceof Error ? err.stack : String(err);
      console.error(`[unfolding] child session for task "${slug}" failed:`, stack);
    });
    let outcome: "finished" | "blocked" | "aborted" | "recreate";
    try {
      outcome = await waitForChildDecision(
        async () => readTask(cwd, slug),
        (_status: string, blocked_reason?: string, recreate_message?: string) => {
          if (recreate_message) {
            stream?.append("  🔄 recreating child session with refreshed tools");
          } else {
            stream?.append(`  ⏸ blocked: ${blocked_reason ?? "(no reason given)"}`);
          }
        },
        undefined,
        signal,
        checkpointRecovery!.getFatalError,
        async () => {
          const task = readTask(cwd, slug);
          return task?.status === "in_progress" && wasLocallyAborted && observedTerminalAbort;
        },
      );
    } catch (error) {
      if (error instanceof Error && error.name === "FatalChildSessionError") {
        if (wasLocallyAborted) {
          outcome = "aborted";
        } else {
          updateTaskStatus(cwd, slug, "blocked", childSessionFailureBlockedReason(error.message.replace(/^fatal child session error in \".*?\":\s*/, "")));
          outcome = "blocked";
        }
      } else {
        throw error;
      }
    }
    const recreateMessage = outcome === "recreate" ? readTask(cwd, slug)?.recreate_message : undefined;
    if (stream) {
      const finalOutputDetails = { childOutputRole: shortRole, childOutputEvents: stream.getOutputEvents() };
      if (outcome === "recreate" && recreateMessage) {
        const resumed = await recreateChildSession({
          cwd,
          slug,
          body,
          activeSessions,
          pi,
          postOutput,
          nestedDelegateToolFactory,
          signal,
          parentSignal,
          onUpdate,
          model,
          authStorage,
          modelRegistry,
          previousSession: session,
        });
        resumed.finalOutputDetails = mergeOutputDetails(finalOutputDetails, resumed.finalOutputDetails);
        resumed.finalSnapshot = [stream.getLines(), resumed.finalSnapshot].filter(Boolean).join("\n");
        return resumed;
      }
      return { session, outcome, recreateMessage, finalSnapshot: stream.getLines(), finalOutputDetails };
    }

    if (outcome === "recreate" && recreateMessage) {
      return recreateChildSession({
        cwd,
        slug,
        body,
        activeSessions,
        pi,
        postOutput,
        nestedDelegateToolFactory,
        signal,
        parentSignal,
        onUpdate,
        model,
        authStorage,
        modelRegistry,
        previousSession: session,
      });
    }

    postOutput(`  💰 $${session.getSessionStats().cost.toFixed(4)} (↑${session.getSessionStats().tokens.input} ↓${session.getSessionStats().tokens.output})`);
    return { session, outcome, recreateMessage };
  } finally {
    checkpointRecovery?.unsubscribe();
    if (onAbort) {
      signal?.removeEventListener("abort", onAbort);
      parentSignal?.removeEventListener("abort", onAbort);
    }
    unsubscribeAbortObserver?.();
    stream?.unsubscribe();
    if (!taskPrepared) activeSessions.delete(slug);
    await shutdown().catch((err: unknown) => {
      console.error(`[unfolding] session_shutdown failed for task "${slug}":`, err);
    });
  }
}

async function recreateChildSession({
  cwd,
  slug,
  body,
  activeSessions,
  pi,
  postOutput,
  nestedDelegateToolFactory,
  signal,
  parentSignal,
  onUpdate,
  model,
  authStorage,
  modelRegistry,
  previousSession,
}: Pick<StartChildSessionParams, "cwd" | "activeSessions" | "pi" | "postOutput" | "nestedDelegateToolFactory" | "signal" | "parentSignal" | "onUpdate" | "model" | "authStorage" | "modelRegistry"> & {
  slug: string;
  body: string;
  previousSession: AgentSession;
}): Promise<ChildSessionRunResult> {
  const existing = readTask(cwd, slug);
  const recreateMessage = existing?.recreate_message;
  if (!existing || !recreateMessage) {
    throw new Error(`Task "${slug}" requested recreation without recreate_message`);
  }
  await previousSession.abort().catch(() => {});
  activeSessions.delete(slug);

  return startChildSessionAttempt({
    cwd,
    from: existing.from,
    role: existing.to,
    slug,
    body,
    parent_slug: existing.parent_slug,
    activeSessions,
    pi,
    postOutput,
    nestedDelegateToolFactory,
    signal,
    parentSignal,
    onUpdate,
    model,
    authStorage,
    modelRegistry,
    existing: readTask(cwd, slug),
  });
}

function mergeOutputDetails(
  first: ChildOutputDetails | undefined,
  second: ChildOutputDetails | undefined,
): ChildOutputDetails | undefined {
  if (!first) return second;
  if (!second) return first;
  return {
    childOutputRole: second.childOutputRole,
    childOutputEvents: [...first.childOutputEvents, ...second.childOutputEvents],
  };
}

export function readTaskSnapshot(cwd: string, slug: string): Task | null {
  return readTask(cwd, slug);
}
