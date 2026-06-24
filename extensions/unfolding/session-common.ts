import {join, resolve} from "node:path";
import type {Model} from "@earendil-works/pi-ai";
import type {AgentSession, AuthStorage, ExtensionAPI, ModelRegistry} from "@earendil-works/pi-coding-agent";
import {createAgentSession, DefaultResourceLoader, getAgentDir, SessionManager} from "@earendil-works/pi-coding-agent";
import {CHILD_FIXED_INSTRUCTION, loadAgentSystemPrompt} from "./task-delegate.ts";
import {createChildTaskTools} from "./child-task-tools.ts";

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
  shortRole: string
}> {
  const rolesDir = resolve(new URL(import.meta.url).pathname, "..", "roles");
  const shortRole = role.replace(/^unfolding-/, "");
  const systemPrompt = loadAgentSystemPrompt(rolesDir, shortRole);
  if (!systemPrompt) throw new Error(`No agent definition found for role "${shortRole}" in ${rolesDir}`);

  const tdderRoot = resolve(new URL(import.meta.url).pathname, "../../..");
  const loader = new DefaultResourceLoader({
    cwd,
    agentDir: getAgentDir(),
    noContextFiles: true,
    additionalExtensionPaths: [join(tdderRoot, "extensions")],
    systemPromptOverride: () => systemPrompt,
  });
  await loader.reload();

  const selectedModel = model ?? resolveCurrentModel(pi);

  const {session} = await createAgentSession({
    cwd,
    sessionManager,
    resourceLoader: loader,
    model: selectedModel,
    authStorage,
    modelRegistry,
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
  activeSessions.set(slug, session);
  return {session, shortRole};
}

export function buildChildInitialMessage(body: string, resumeMessage?: string): string {
  return resumeMessage
    ? `${resumeMessage}\n\n${CHILD_FIXED_INSTRUCTION}`
    : `${body}\n\n${CHILD_FIXED_INSTRUCTION}`;
}
