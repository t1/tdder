import type { Model } from "@earendil-works/pi-ai";
import type { ExtensionAPI, AgentSession, AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { createSnapshotCommit, ensureGitRepoWithHead, isWorkspaceDirty } from "./git-task-state.ts";
import { createTask, readTask, updateTaskStatus, type Task } from "./task-store.ts";
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
  outcome: "finished" | "blocked" | "aborted";
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
  const initialMessage = buildChildInitialMessage(body, existing?.resume_message);

  const { session, shortRole, shutdown } = await createChildAgentSession({
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

  let wasLocallyAborted = signal?.aborted === true || parentSignal?.aborted === true;
  const stream = onUpdate ? streamChildSession(session, shortRole, slug, onUpdate, {
    sessionFile: session.sessionFile,
  }) : undefined;
  const onAbort = () => {
    wasLocallyAborted = true;
    session.abort().catch(() => {});
  };
  signal?.addEventListener("abort", onAbort);
  parentSignal?.addEventListener("abort", onAbort);
  let observedTerminalAbort = false;
  const unsubscribeAbortObserver = session.subscribe((event: any) => {
    if (event?.type === "message_end" && event.message?.role === "assistant" && event.message?.stopReason === "aborted") {
      observedTerminalAbort = true;
    }
  });
  const checkpointRecovery = installCheckpointRecovery(session, cwd, slug, {
    onRecoveryNote: stream?.append,
  });
  try {
    session.prompt(initialMessage).catch((err: unknown) => {
      const stack = err instanceof Error ? err.stack : String(err);
      console.error(`[unfolding] child session for task "${slug}" failed:`, stack);
    });
    let outcome: "finished" | "blocked" | "aborted";
    try {
      outcome = await waitForChildDecision(
        async () => readTask(cwd, slug),
        (_status: string, blocked_reason?: string) => {
          stream?.append(`  ⏸ blocked: ${blocked_reason ?? "(no reason given)"}`);
        },
        undefined,
        signal,
        checkpointRecovery.getFatalError,
        async () => {
          const task = readTask(cwd, slug);
          return task?.status === "in_progress" && (wasLocallyAborted || observedTerminalAbort);
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
    const stats = session.getSessionStats();
    const costLine = `  💰 $${stats.cost.toFixed(4)} (↑${stats.tokens.input} ↓${stats.tokens.output})`;
    if (stream) {
      const finalSnapshot = stream.getLines() + "\n" + costLine;
      // Show final transcript + cost via the tool's own update callback, NOT via postOutput.
      // postOutput() calls pi.sendMessage() which, while isStreaming=true, enqueues the message
      // as a steer. Each steer triggers an extra inner-loop LLM call. After
      // filterDisplayOnlyMessages removes the custom message from the context, the last remaining
      // message may be an assistant message — causing Anthropic/Bedrock to return:
      //   400 "This model does not support assistant message prefill."
      // The live onUpdate display already showed the transcript incrementally.
      // Using onUpdate here for the final state shows it in the tool-update area (during tool
      // execution) without triggering a steer or an extra LLM call.
      const finalOutputDetails = { childOutputRole: shortRole, childOutputEvents: stream.getOutputEvents() };
      onUpdate?.({ content: [{ type: "text", text: finalSnapshot }], details: finalOutputDetails });
      return { session, outcome, finalSnapshot, finalOutputDetails };
    }

    postOutput(costLine);
    return { session, outcome };
  } finally {
    checkpointRecovery.unsubscribe();
    signal?.removeEventListener("abort", onAbort);
    parentSignal?.removeEventListener("abort", onAbort);
    unsubscribeAbortObserver();
    stream?.unsubscribe();
    await shutdown().catch((err: unknown) => {
      console.error(`[unfolding] session_shutdown failed for task "${slug}":`, err);
    });
  }
}

export function readTaskSnapshot(cwd: string, slug: string): Task | null {
  return readTask(cwd, slug);
}
