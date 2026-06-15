import { Type } from "typebox";
import { taskFinished, taskBlock } from "./task-tools.ts";

export function createChildTaskTools(cwd: string, slug: string, nestedDelegateTool: any): any[] {
  return [
    {
      name: "task_finished",
      label: "Task finished",
      description: "Mark the current delegated task as finished and stop the current run.",
      parameters: Type.Object({}),
      async execute(_id: string, _params: {}, _signal: any, _onUpdate: any, ctx: any) {
        taskFinished(cwd, slug);
        ctx.abort();
        return { content: [{ type: "text", text: "task finished" }], details: {} };
      },
    },
    {
      name: "task_block",
      label: "Task block",
      description: "Mark the current delegated task as blocked and stop the current run.",
      parameters: Type.Object({
        blocked_reason: Type.String({ description: "Why the task is blocked" }),
      }),
      async execute(_id: string, blockParams: { blocked_reason: string }, _signal: any, _onUpdate: any, ctx: any) {
        taskBlock(cwd, slug, blockParams.blocked_reason);
        ctx.abort();
        return { content: [{ type: "text", text: "task blocked" }], details: {} };
      },
    },
    nestedDelegateTool,
  ];
}
