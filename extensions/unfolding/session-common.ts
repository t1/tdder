import {resolve} from "node:path";
import type {Model} from "@earendil-works/pi-ai";
import type {AgentSession, AuthStorage, ExtensionAPI, ModelRegistry} from "@earendil-works/pi-coding-agent";
import {createAgentSession, DefaultResourceLoader, getAgentDir, SessionManager} from "@earendil-works/pi-coding-agent";
import {CHILD_FIXED_INSTRUCTION, loadAgentRoleConfig} from "./task-delegate.ts";
import {createChildTaskTools} from "./child-task-tools.ts";
import {resolveToolAllowlist} from "./unfold-helpers.ts";

export type NestedDelegateToolFactory = (shortRole: string) => any;

export interface ChildSessionBuildParams {
  cwd: string;
  role: string;
  slug: string;
  sessionManager: SessionManager;
  activeSessions: Map<string, AgentSession>;
  pi: ExtensionAPI;
  postOutput: (lines: string) => void;
  nestedDelegateToolFactory: NestedDelegateToolFactory;
  model?: Model<any>;
  authStorage?: AuthStorage;
  modelRegistry?: ModelRegistry;
}

export function resolveCurrentModel(_pi: ExtensionAPI): Model<any> | undefined {
  return undefined;
}

function inheritedExtensionPaths(pi: ExtensionAPI): string[] {
  const paths = (pi as any).__unfoldingExtensionPaths;
  return Array.isArray(paths) ? paths.filter((path): path is string => typeof path === "string" && path.length > 0) : [];
}

async function emitSessionShutdown(session: AgentSession): Promise<void> {
  // bindExtensions() fires session_start on extensions (e.g. quarkus MCP client startup).
  // There is no public API to emit session_shutdown, so we reach into the private runner.
  // This is intentional: the SDK omits this path for raw createAgentSession() callers.
  const runner = (session as any)._extensionRunner;
  if (runner?.hasHandlers?.("session_shutdown")) {
    await runner.emit({type: "session_shutdown", reason: "shutdown"});
  }
}

export async function createChildAgentSession({
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
                                              }: ChildSessionBuildParams): Promise<{
  session: AgentSession;
  shortRole: string;
  shutdown: () => Promise<void>;
}> {
  const rolesDir = resolve(new URL(import.meta.url).pathname, "..", "roles");
  const shortRole = role.replace(/^unfolding-/, "");
  const roleConfig = loadAgentRoleConfig(rolesDir, shortRole);
  if (!roleConfig) throw new Error(`No agent definition found for role "${shortRole}" in ${rolesDir}`);
  const systemPrompt = roleConfig.systemPrompt;

  const loader = new DefaultResourceLoader({
    cwd,
    agentDir: getAgentDir(),
    noContextFiles: true,
    additionalExtensionPaths: inheritedExtensionPaths(pi),
    systemPromptOverride: () => systemPrompt,
  });
  await loader.reload();

  const selectedModel = model ?? resolveCurrentModel(pi);
  const liveToolNames = pi.getAllTools?.().map((t: any) => t.name) ?? [];
  const resolvedTools = roleConfig.tools ? resolveToolAllowlist(roleConfig.tools, liveToolNames) : undefined;

  const {session} = await createAgentSession({
    sessionStartEvent: {type: "session_start", reason: "startup"},
    cwd,
    sessionManager,
    resourceLoader: loader,
    model: selectedModel,
    authStorage,
    modelRegistry,
    tools: resolvedTools,
    excludeTools: ["task_list", "task_read"],
    customTools: createChildTaskTools(cwd, slug, nestedDelegateToolFactory(shortRole), {
      activeSessions,
      postOutput,
      pi,
      askSensei: (pi as any).__unfoldingAskSensei,
      model: selectedModel,
      modelRegistry,
      debugExportsEnabled: (pi as any).__unfoldingDebugExportsEnabled === true,
    }),
  });
  session.setSessionName(slug);
  await session.bindExtensions({});
  activeSessions.set(slug, session);
  return {session, shortRole, shutdown: () => emitSessionShutdown(session)};
}

export function buildChildInitialMessage(body: string, resumeMessage?: string): string {
  return resumeMessage
    ? `${resumeMessage}\n\n${CHILD_FIXED_INSTRUCTION}`
    : `${body}\n\n${CHILD_FIXED_INSTRUCTION}`;
}
