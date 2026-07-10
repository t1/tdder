# Quarkus extension

Integrates [quarkus-agent-mcp](https://github.com/quarkusio/quarkus-agent-mcp) into pi so the LLM can manage Quarkus projects and dev-mode workflows through native `quarkus_*` tools.

## Bootstrap and session recreation

`quarkus_bootstrap` is a bootstrap-only tool for empty or non-Quarkus Maven projects.
It creates the minimal `pom.xml` needed for Quarkus tooling to activate.

On success, `quarkus_bootstrap` returns tool-result metadata:

- `details.requiresSessionRecreation = true`

That metadata means the current session should not continue ordinary tool-driven work.
A fresh session is needed so the normal Quarkus tool set is available in the updated workspace.

The `quarkus` extension does **not** know about `unfolding` or any specific session-ending tool.
It only declares the lifecycle fact that successful bootstrap requires session recreation.

## Cross-cutting enforcement

The generic enforcement lives in the `hygiene` extension:

- it watches `tool_result` for `details.requiresSessionRecreation = true`
- then blocks later `tool_call` events in that session
- except for tools explicitly registered as allowed session-enders by policy

This is a best-effort same-turn guard. It reliably blocks later tool calls after the triggering result is observed, but it cannot prevent sibling tool calls that were already emitted in the same assistant message before that result existed.
