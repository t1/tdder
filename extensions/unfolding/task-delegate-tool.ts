import { resolve, join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { AgentSession, createAgentSession, DefaultResourceLoader, SessionManager, getAgentDir } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { ensureGitignore, createTask, readTask, updateTaskStatus } from "./task-store.ts";
import { loadAgentSystemPrompt, streamChildSession, waitForChildDecision, CHILD_FIXED_INSTRUCTION } from "./task-delegate.ts";
import { createChildTaskTools } from "./child-task-tools.ts";

export function makeTaskDelegateDefinition(from: string, activeSessions: Map<string, AgentSession>, pi: ExtensionAPI, postOutput: (lines: string) => void): any {
  return {
    name: "task_delegate",
    label: "Task delegate",
    description: "Delegate work to a role sub-session and wait for it to finish or block. If this tool throws an error, treat it as a critical bug — stop all work immediately and report the full error message to the user.",
    parameters: Type.Object({
      role: Type.String({ description: "Role to delegate to (e.g. po, architect, coder)" }),
      slug: Type.String({ description: "Unique slug for this task" }),
      body: Type.String({ description: "Task description for the role" }),
      parent_slug: Type.Optional(Type.String({ description: "Slug of the parent task, if this is a sub-delegation" })),
    }),
    async execute(_id: string, params: { role: string; slug: string; body: string; parent_slug?: string }, signal: AbortSignal | undefined, onUpdate: any, ctx: any) {
      try {
        const rolesDir = resolve(new URL(import.meta.url).pathname, "..", "roles");
        const shortRole = params.role.replace(/^unfolding-/, "");
        const systemPrompt = loadAgentSystemPrompt(rolesDir, shortRole);
        if (!systemPrompt) {
          throw new Error(`No agent definition found for role "${shortRole}" in ${rolesDir}`);
        }

        ensureGitignore(ctx.cwd);
        const existing = readTask(ctx.cwd, params.slug);
        const initialMessage = existing?.resume_message
          ? `${existing.resume_message}\n\n${CHILD_FIXED_INSTRUCTION}`
          : `${params.body}\n\n${CHILD_FIXED_INSTRUCTION}`;

        const tdderRoot = resolve(new URL(import.meta.url).pathname, "../../..");
        const loader = new DefaultResourceLoader({
          cwd: ctx.cwd,
          agentDir: getAgentDir(),
          noContextFiles: true,
          additionalExtensionPaths: [join(tdderRoot, "extensions")],
          systemPromptOverride: () => systemPrompt,
        });
        await loader.reload();

        const { session } = await createAgentSession({
          cwd: ctx.cwd,
          sessionManager: SessionManager.create(ctx.cwd),
          resourceLoader: loader,
          excludedToolNames: ["task_list", "task_read"],
          customTools: createChildTaskTools(
            ctx.cwd,
            params.slug,
            makeTaskDelegateDefinition(shortRole, activeSessions, pi, postOutput),
          ),
        });

        activeSessions.set(params.slug, session);

        if (existing) {
          updateTaskStatus(ctx.cwd, params.slug, "in_progress");
        } else {
          createTask(ctx.cwd, {
            slug: params.slug,
            from,
            to: params.role,
            body: params.body,
            parent_slug: params.parent_slug,
            session_id: session.sessionId,
            session_file: session.sessionFile,
          });
        }
        signal?.addEventListener("abort", () => { session.abort().catch(() => {}); });

        session.prompt(initialMessage).catch((err: unknown) => {
          const stack = err instanceof Error ? err.stack : String(err);
          console.error(`[unfolding] child session for task "${params.slug}" failed:`, stack);
        });

        const stream = onUpdate
          ? streamChildSession(session, shortRole, params.slug, onUpdate)
          : undefined;

        const outcome = await waitForChildDecision(
          async () => readTask(ctx.cwd, params.slug),
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

        if (outcome === "aborted") {
          activeSessions.delete(params.slug);
          return { content: [{ type: "text", text: `Task "${params.slug}" aborted.` }], details: {} };
        }

        return {
          content: [{ type: "text", text: `Task "${params.slug}" delegated to ${params.role}. Outcome: ${outcome}` }],
          details: {},
        };
      } catch (err: unknown) {
        activeSessions.delete(params.slug);
        const stack = err instanceof Error ? err.stack ?? err.message : String(err);
        throw new Error(`task_delegate failed:\n${stack}`);
      }
    },
  };
}
