# idea extension

Read `extensions/AGENTS.md` (parent) before this file.

## Decisions captured

### projectPath auto-injection

The JetBrains MCP requires `projectPath` on every project-scoped tool call. Wrong or missing
`projectPath` returns a uniform `isError: true` payload with the list of currently open projects.

The extension **always injects pi's CWD as `projectPath`** on every forwarded call, and
**keeps `projectPath` out of the public tool schema** so the LLM never sees it as a parameter.
Same way the LLM doesn't think about filesystem roots — `projectPath` is implicit context
the extension manages, not something the LLM should reason about.

### SSE client: hand-rolled

We use `node:http` + manual SSE frame parsing + JSON-RPC over POST. No `eventsource`
package, no `@modelcontextprotocol/sdk`. Reasons:

- The MCP surface we use is small (initialise + tools/list + tools/call). The SDK would be
  more dependency mass than the protocol it implements.
- We already proved by hand probe that the protocol works with plain HTTP. Translating
  that probe into TypeScript is straightforward.
- Hand-rolling makes the wire behaviour visible in our own code, which matters when
  diagnosing why an LLM call to the IDE went wrong.

Revisit if the SDK starts paying for itself across multiple MCP-backed extensions.

### Testing framework: vitest

Vitest because:

- ESM-native (matches `"type": "module"` in `package.json`)
- TypeScript runs without a separate compile step
- Watch mode and parameterised tests have low ceremony
- Wide use in the TS ecosystem

`node:test` would also work but loses on DX. Document this choice rather than re-derive
it later.

### Extension contract (tests assert against extension outputs, not raw MCP)

E2E tests and unit tests both call into the extension's public surface, never into the
raw MCP response shape. The extension owns the responsibility of translating JetBrains'
prose into stable, typed outputs:

- **Success outputs** are typed and structured (not raw text blobs)
- **Failure outputs** are classified, e.g.
  `{ kind: "project-not-open" | "tool-missing" | "transport-error" | "ide-unreachable" | ... }`
- Prose parsing (e.g. detecting "doesn't correspond to any open project" in an error
  payload) lives **inside the extension**, not in tests

Consequences:

- If JetBrains tweaks wording, the extension absorbs it; tests stay green
- If JetBrains removes underlying behaviour, the extension can no longer classify it;
  tests fail honestly with a meaningful error
- Every tool wrapper has a defined contract from day one. This is an architectural
  decision that affects how every tool is wrapped

### E2E tests and tier plan

Read `decisions/e2e-testing.md` when working on the E2E suite.

### Adding or modifying a tool spec

Read `decisions/mcp-probing.md` before adding a tool or changing a tool spec (probe scripts,
`collapseResult` design, live-IDE verification rule).

### Debugger design decisions

Read `decisions/debugger.md` when touching any `xdebug_*` tool (security dialogue scope,
widget detection, registered-but-safe tools).

### MCP behaviour during indexing

Read `decisions/mcp-indexing.md` when touching retry logic, `rename_refactoring`, or any
indexing-related edge case (per-tool immunity table, error text patterns, filed upstream issue).

### TDD discipline

Follow the `tdd` skill. HITL is `off` at the repo level, so cycles run autonomously
and report at the end. Baby steps still apply — never bundle two test cycles.

### No phase-state machinery

The extension does **not** filter tools by TDD phase (Red/Green/Refactor). Discipline stays with
the `tdd` and `clean-code` skills. Considered and rejected because no machine-readable phase state
exists today and inventing one is a multi-week project with no clear benefit.

### No `idea` skill: create only when patterns accumulate

The modes vocabulary (explore/modify × code/runtime/session) lives in the extension's top-level
description and per-tool tags, not in a dedicated skill. Spin out an `idea` skill only when
cross-tool patterns accumulate — e.g. "always `search_symbol` before `rename_refactoring`".
Don't create it speculatively.

Related: consider propagating the modes vocabulary into `tdd`, `clean-code`, `maven`, and
`unfolding-architecture` only if real confusion shows up in practice.

### Caret position / current selection: confirmed absent

The JetBrains MCP `open_file_in_editor` only takes `filePath` — no line, column, or selection
range. Confirmed by live probe. Revisit if JetBrains exposes it in a future plugin version.

### Inspection authoring tools: not registered

The JetBrains MCP plugin exposes four inspection-authoring tools (`generate_inspection_kts_api`,
`generate_inspection_kts_examples`, `generate_psi_tree`, `run_inspection_kts`). All four are
reachable and functional (confirmed by live probe against a real project). They are not registered
in this extension.

**Pattern-finding is already covered.** `search_in_files_by_regex` and `search_symbol` handle
the "find instances of X across the codebase" use case without requiring PSI-level semantics.
The cases where regex genuinely can't express the structural pattern are rarer than they appear.

**Architectural enforcement belongs in CI.** Rules that "should hold in the future" need to be
in the test suite — ArchUnit, Checkstyle, a build-time check — not only in the IDE. An IDE-only
inspection is a reminder, not enforcement. It doesn't fail the build, it's invisible to developers
who haven't opened the file, and it disappears between sessions.

**The one compelling scenario is already handled.** Running existing inspections as a pre-flight
check before editing is already covered by `get_file_problems`, which surfaces the active
inspection profile automatically. No explicit `run_inspection_kts` call is needed.

**If reconsidered:** the value is in `run_inspection_kts` as a runner against *existing*
human-authored inspections, not in the LLM authoring new ones. Scope it to that, not to the
full authoring workflow.
