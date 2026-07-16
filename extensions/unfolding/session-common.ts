import {existsSync, readdirSync} from "node:fs";
import {basename, dirname, join, resolve} from "node:path";
import type {Model} from "@earendil-works/pi-ai";
import type {AgentSession, AuthStorage, ExtensionAPI, ExtensionUIContext, ModelRegistry} from "@earendil-works/pi-coding-agent";
import {createAgentSession, DefaultResourceLoader, getAgentDir, SessionManager} from "@earendil-works/pi-coding-agent";
import {CHILD_FIXED_INSTRUCTION, loadAgentRoleConfig} from "./task-delegate.ts";
import {createChildTaskTools} from "./child-task-tools.ts";
import { makeTaskContinueDefinition } from "./task-delegate-tool.ts";
import {resolveToolAllowlist, isPathAllowed} from "./unfold-helpers.ts";
import { isQuarkusProject } from "../shared/quarkus-project.ts";
import type { CostLedger } from "./cost-ledger.ts";
import type { ChildUiEvent } from "./task-delegate.ts";
import { getCapturedRootUiContext } from "./ask-sensei.ts";

export type NestedDelegateToolFactory = (shortRole: string, currentCommissionerSlug: string) => any;

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
  costLedger?: CostLedger;
  childUiBus?: ChildUiBus;
}

export interface ChildUiBus {
  emit(event: ChildUiEvent): void;
  subscribe(listener: (event: ChildUiEvent) => void): () => void;
}

export function resolveCurrentModel(_pi: ExtensionAPI): Model<any> | undefined {
  return undefined;
}

export function createChildUiBus(): ChildUiBus {
  const listeners = new Set<(event: ChildUiEvent) => void>();
  return {
    emit(event: ChildUiEvent) {
      for (const listener of [...listeners]) listener(event);
    },
    subscribe(listener: (event: ChildUiEvent) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function createChildUiContext(pi: ExtensionAPI, _role: string, bus: ChildUiBus, theme: ExtensionUIContext["theme"]): ExtensionUIContext {
  const rootUi = getCapturedRootUiContext(pi);
  const interactiveUi = rootUi?.ui;
  return {
    select: async (title, options, opts) => interactiveUi?.select(title, options, opts),
    confirm: async (title, message, opts) => interactiveUi?.confirm(title, message, opts) ?? false,
    input: async (title, placeholder, opts) => interactiveUi?.input(title, placeholder, opts),
    notify: (message, _type) => {
      bus.emit({type: "note", text: `  [${_role}] ℹ ${message}`});
    },
    onTerminalInput: () => () => {},
    setStatus: (key, text) => {
      bus.emit({type: "status", key, text});
    },
    setWorkingMessage: () => {},
    setWorkingVisible: () => {},
    setWorkingIndicator: () => {},
    setHiddenThinkingLabel: () => {},
    setWidget: (key, content) => {
      bus.emit({type: "widget", key, lines: Array.isArray(content) ? content : undefined});
    },
    setFooter: () => {},
    setHeader: () => {},
    setTitle: () => {},
    custom: async (factory, options) => interactiveUi?.custom(factory as any, options as any),
    pasteToEditor: (text) => interactiveUi?.pasteToEditor?.(text),
    setEditorText: (text) => interactiveUi?.setEditorText?.(text),
    getEditorText: () => interactiveUi?.getEditorText?.() ?? "",
    editor: async (title, prefill) => interactiveUi?.editor(title, prefill),
    addAutocompleteProvider: () => {},
    setEditorComponent: () => {},
    getEditorComponent: () => undefined,
    get theme() {
      return theme;
    },
    getAllThemes: () => interactiveUi?.getAllThemes?.() ?? [],
    getTheme: (name) => interactiveUi?.getTheme?.(name),
    setTheme: (nextTheme) => interactiveUi?.setTheme?.(nextTheme) ?? ({success: false, error: "UI not available"}),
    getToolsExpanded: () => interactiveUi?.getToolsExpanded?.() ?? false,
    setToolsExpanded: (expanded) => interactiveUi?.setToolsExpanded?.(expanded),
    __unfoldingProxy: true,
    __unfoldingRootMode: rootUi?.mode,
  } as ExtensionUIContext & { __unfoldingProxy?: true; __unfoldingRootMode?: string };
}

function filterActiveToolsForWorkspace(cwd: string, toolNames: string[]): string[] {
  if (!isQuarkusProject(cwd)) return toolNames;
  return toolNames.filter((toolName) => toolName !== "quarkus_bootstrap");
}

function bundledSiblingExtensionPaths(): string[] {
  const currentExtensionDir = dirname(new URL(import.meta.url).pathname);
  const currentExtensionName = basename(currentExtensionDir);
  const extensionsDir = resolve(currentExtensionDir, "..");
  if (!existsSync(extensionsDir)) return [];

  return readdirSync(extensionsDir, {withFileTypes: true})
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => name !== currentExtensionName && name !== "shared")
    .map((name) => resolve(extensionsDir, name))
    .filter((dir) => existsSync(join(dir, "index.ts")) && existsSync(join(dir, "package.json")));
}

function inheritedExtensionPaths(pi: ExtensionAPI): string[] {
  const inherited = (pi as any).__unfoldingExtensionPaths;
  const captured = Array.isArray(inherited)
    ? inherited.filter((path): path is string => typeof path === "string" && path.length > 0)
    : [];
  return [...new Set([...captured, ...bundledSiblingExtensionPaths()])];
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
                                                costLedger,
                                                childUiBus,
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
  // When the allowlist contains wildcards, we can't resolve extension tools yet
  // (they load during bindExtensions). Pass no tools filter to createAgentSession
  // and apply the full resolved allowlist via setActiveToolsByName afterwards.
  const hasWildcards = roleConfig.tools?.some(t => t.endsWith("*")) ?? false;
  const resolvedTools = roleConfig.tools && !hasWildcards
    ? filterActiveToolsForWorkspace(cwd, resolveToolAllowlist(roleConfig.tools, liveToolNames))
    : undefined;

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
    customTools: createChildTaskTools(cwd, slug, nestedDelegateToolFactory(shortRole, slug), makeTaskContinueDefinition(shortRole, activeSessions, pi, postOutput, undefined, undefined, slug, costLedger), {
      activeSessions,
      postOutput,
      pi,
      role: shortRole,
      model: selectedModel,
      modelRegistry,
      debugExportsEnabled: (pi as any).__unfoldingDebugExportsEnabled === true,
      costLedger,
    }),
  });
  session.setSessionName(slug);
  await session.bindExtensions({});

  if (childUiBus) {
    const runner = (session as any)._extensionRunner;
    const theme = runner?.getUIContext?.().theme;
    if (runner?.setUIContext && theme) {
      runner.setUIContext(createChildUiContext(pi, shortRole, childUiBus, theme), "tui");
    }
  }

  if (hasWildcards && roleConfig.tools) {
    const allToolNames = session.getAllTools().map((t: any) => t.name);
    const reResolved = filterActiveToolsForWorkspace(cwd, resolveToolAllowlist(roleConfig.tools, allToolNames));
    session.setActiveToolsByName(reResolved);
  }

  if (roleConfig.pathRestrictions?.length) {
    const restrictions = roleConfig.pathRestrictions;
    const runner = (session as any)._extensionRunner;
    if (runner) {
      const original = runner.emitToolCall.bind(runner);
      runner.emitToolCall = async (event: any) => {
        const toolName = event.toolName as string;
        const path = event.input?.path as string | undefined;
        if (path && (toolName === "read" || toolName === "write" || toolName === "edit")) {
          if (!isPathAllowed(toolName, path, restrictions)) {
            return { block: true, reason: `Path '${path}' is not allowed for the ${toolName} tool in the ${shortRole} role. Call task_block immediately with a description of what your task asked you to do.` };
          }
        }
        return original(event);
      };
    }
  }

  activeSessions.set(slug, session);
  return {session, shortRole, shutdown: () => emitSessionShutdown(session)};
}

export function buildChildInitialMessage(body: string, resumeMessage?: string): string {
  return resumeMessage
    ? `${resumeMessage}\n\n${CHILD_FIXED_INSTRUCTION}`
    : `${body}\n\n${CHILD_FIXED_INSTRUCTION}`;
}
