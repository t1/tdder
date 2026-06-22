import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { AgentSession } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { startChildSession } from "./session-factory.ts";
import { createAskSenseiFn } from "./ask-sensei.ts";

export function makeTaskDelegateDefinition(
  from: string,
  activeSessions: Map<string, AgentSession>,
  pi: ExtensionAPI,
  postOutput: (lines: string) => void,
  onChildOutcome?: (cwd: string, slug: string, outcome: "finished" | "blocked" | "aborted") => Promise<void> | void,
): any {
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
      (pi as any).__unfoldingAskSensei = createAskSenseiFn(ctx);
      try {
        const { outcome } = await startChildSession({
          cwd: ctx.cwd,
          from,
          role: params.role,
          slug: params.slug,
          body: params.body,
          parent_slug: params.parent_slug,
          activeSessions,
          pi,
          postOutput,
          nestedDelegateToolFactory: (shortRole: string) =>
            makeTaskDelegateDefinition(shortRole, activeSessions, pi, postOutput, onChildOutcome),
          signal,
          onUpdate,
          model: ctx.model,
          modelRegistry: ctx.modelRegistry,
        });

        await onChildOutcome?.(ctx.cwd, params.slug, outcome);

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
