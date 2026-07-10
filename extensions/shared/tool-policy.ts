import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export interface ToolPolicy {
  allowsAfterRequiresSessionRecreation?: boolean;
}

const TOOL_POLICY_REGISTRY_KEY = Symbol.for("tdder.tool-policy-registry");

type ToolPolicyExtensionAPI = ExtensionAPI & {
  [TOOL_POLICY_REGISTRY_KEY]?: Map<string, ToolPolicy>;
};

export function getToolPolicyRegistry(pi: ExtensionAPI): Map<string, ToolPolicy> {
  const typed = pi as ToolPolicyExtensionAPI;
  typed[TOOL_POLICY_REGISTRY_KEY] ??= new Map<string, ToolPolicy>();
  return typed[TOOL_POLICY_REGISTRY_KEY]!;
}

export function registerToolPolicy(pi: ExtensionAPI, toolName: string, policy: ToolPolicy): void {
  const registry = getToolPolicyRegistry(pi);
  registry.set(toolName, {
    ...registry.get(toolName),
    ...policy,
  });
}

export function getToolPolicy(pi: ExtensionAPI, toolName: string): ToolPolicy | undefined {
  return getToolPolicyRegistry(pi).get(toolName);
}
