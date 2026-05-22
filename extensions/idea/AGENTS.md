# idea extension

Read `extensions/AGENTS.md` (parent) before this file. The no-peeking rule applies:
do not read any sibling extension's source during v0.1.

## Decisions captured

### projectPath auto-injection

The JetBrains MCP requires `projectPath` on every project-scoped tool call. Wrong or missing
`projectPath` returns a uniform `isError: true` payload with the list of currently open projects.

The extension **always injects pi's CWD as `projectPath`** on every forwarded call, and
**keeps `projectPath` out of the public tool schema** so the LLM never sees it as a parameter.
Same way the LLM doesn't think about filesystem roots — `projectPath` is implicit context
the extension manages, not something the LLM should reason about.

This pattern may or may not generalise to other MCPs. Until we have a second MCP-backed
extension to compare against, it stays here, not in the parent AGENTS.md.

### SSE client: hand-rolled

We use `node:http` + manual SSE frame parsing + JSON-RPC over POST. No `eventsource`
package, no `@modelcontextprotocol/sdk`. Reasons:

- The MCP surface we use is small (initialize + tools/list + tools/call). The SDK would be
  more dependency mass than the protocol it implements.
- We already proved by hand probe that the protocol works with plain HTTP. Translating
  that probe into TypeScript is straightforward.
- Hand-rolling makes the wire behaviour visible in our own code, which matters when
  diagnosing why an LLM call to the IDE went wrong.

Revisit if a second MCP-backed extension lands and the SDK starts to pay for itself
across both.

### Testing framework: vitest

Fresh choice, made without looking at sibling extensions per the no-peeking rule.
Vitest because:

- ESM-native (matches `"type": "module"` in `package.json`)
- TypeScript runs without a separate compile step
- Watch mode and parameterised tests have low ceremony
- Wide use in the TS ecosystem

`node:test` would also work but loses on DX. Document this choice rather than re-derive
it later.

### TDD discipline

Follow the `tdd` skill. HITL is `off` at the repo level, so cycles run autonomously
and report at the end. Baby steps still apply — never bundle two test cycles.

## v0.1 scope reminder

See `README.md` (repo root) "idea" extension section for the full v0.1 TODO list.
TL;DR: 8 read-only `explore/code` tools, lazy MCP connect, footer status with three
states, `/idea status` slash command, `projectPath` auto-injection.

Do **not** add v0.2+ functionality until v0.1 is shipped and exercised.
