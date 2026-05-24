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

- The MCP surface we use is small (initialize + tools/list + tools/call). The SDK would be
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

### E2E tests (opt-in, drift detection)

**Mission:** catch JetBrains MCP drift (renamed tools, changed response shapes,
removed behaviours). **Not** a regression suite for extension logic — unit tests
cover that.

**Rules:**

- Separate suite: `npm run test:e2e`, never runs under `npm test`
- Never runs in CI; runs only when explicitly invoked by a developer
- Serial execution: no test parallelism for E2E (avoid fixture/connection collisions)
- Tests assert against extension outputs (see "Extension contract" above), not raw MCP
  payloads

**Prerequisite enforcement — `beforeAll` throws with one of three distinct, actionable
messages:**

1. IDE not reachable on `127.0.0.1:64342` →
   *"IntelliJ IDEA does not appear to be running. Run `/idea open` in pi to launch
   it with this project, wait for indexing to finish, then re-run the tests."*
2. IDE reachable but tdder not in open projects →
   *"IntelliJ IDEA is running but the tdder project is not open. Run `/idea open`
   to open it (or use File → Open), then re-run."* (List the projects that *are*
   open, from the probe payload.)
3. IDE + project OK, but MCP plugin missing or wrong protocol version →
   *"The JetBrains MCP Server plugin is not responding correctly. Install/enable it
   from the JetBrains Marketplace."*

These are `beforeAll` errors, not `expect()` assertions — the suite couldn't run, it
didn't fail.

### E2E tier plan

**Tier 1 — read-only, coarse assertions:**

- All registered tools called against the tdder project itself
- Coarse assertions only: "got a response", "shape matches the extension's typed
  output", "errors classify correctly"
- No fixtures yet
- No mutations (no rename, no replace, no debugger)

**Tier 2 (when needed) — fixture-based exact validation:**

- TypeScript fixture files under `extensions/idea/test/e2e/fixtures/*.fixture.ts`
- Named `.fixture.ts` to stay out of vitest's `*.test.ts` glob
- Excluded from `tsconfig.json` so the project's own type-check doesn't flag them
- IDEA's TS service inspects them automatically when the project is open (no JDK,
  no module setup required, unlike a Java equivalent)
- Used to validate exact problem detection (`get_file_problems`), exact symbol
  resolution (`get_symbol_info`), etc.

**Tier 3 — mutation tests on file copies:**

Deferred. Before implementing, the following questions must have concrete answers:

- The IDE only refactors files it has indexed. New files must live inside the open
  project (not `/tmp`). How do we know indexing is complete after creating the file?
  No MCP signal exists today.
- `rename_refactoring` is project-wide. How do we guarantee the fixture's symbol names
  collide with *no* real symbol elsewhere in the project?
- Cleanup is best-effort. If the test process crashes mid-rename, how do we recover
  ghost symbols left in IDE indexes?
- vitest parallelism would let two tests collide on the same fixture filename. How do
  we serialize (file-level lock? UUID suffixes? `--no-file-parallelism`?)?
- The fixture lives in the developer's working copy. How do we communicate "this test
  mutates your tree, commit first" so it's impossible to miss?

Do not start Tier 3 until all five are answered.

### Exploring the live MCP server

Before adding a tool, or changing a tool spec in any way where response shape or parameter details are relevant (
guidance, `collapseResult`, parameter schema), run two probes. Both are cheap (one round-trip each)
and together they give everything needed to write correct parameter schemas, guidance, and
`collapseResult` renderers.

Use `McpClient` directly via `npx tsx` — do **not** hand-roll raw `curl`/`node:http` scripts.
A raw script hit CRLF parsing issues and timed out; `McpClient` already handles all of that.

**`import.meta.url` does not resolve correctly in heredoc probe scripts.** When running
`npx tsx - << 'EOF'`, `import.meta.url` resolves to something stdin-based, not the
extensions/idea directory. Hardcode the project path in the `McpClient` constructor.

#### Probe 1 — list all tools and their parameters

Run once to see what the IDE currently advertises. Reveals parameter names and which are required.

```bash
cd extensions/idea
npx tsx - << 'EOF'
import { McpClient } from "./mcp-client.ts";

const client = new McpClient("http://127.0.0.1:64342", "/path/to/open/project");
await client.connect();
const tools = await client.listTools() as Array<{
  name: string;
  inputSchema?: { properties?: Record<string, unknown>; required?: string[] };
}>;

for (const t of tools) {
  const props = Object.keys(t.inputSchema?.properties ?? {}).filter(k => k !== "projectPath");
  const req = (t.inputSchema?.required ?? []).filter(k => k !== "projectPath");
  console.log(`${t.name}  params=[${props.join(", ")}]  required=[${req.join(", ")}]`);
}
await client.close();
process.exit(0);
EOF
```

#### Probe 2 — call the tool and inspect the response shape

Run for each tool being added. Shows the exact JSON structure so `collapseResult` can
reference real field names, not guesses.

```bash
cd extensions/idea
npx tsx - << 'EOF'
import { McpClient } from "./mcp-client.ts";

const client = new McpClient("http://127.0.0.1:64342", "/path/to/open/project");
await client.connect();
const result = await client.callTool("TOOL_NAME", { /* required params */ });
console.log(JSON.stringify(result, null, 2));
await client.close();
process.exit(0);
EOF
```

Replace `TOOL_NAME` and supply any required parameters. The output is the classified
`ToolCallResult` the extension itself sees — same shape the `collapseResult` renderer receives.

**Do not write a `collapseResult` before running Probe 2.** Before assuming the IDE is
unavailable, check: run Probe 1. If it connects, the IDE is up and both probes are cheap.
If the connection is refused, ask the user to start IDEA (or run `/idea open`) and wait
before proceeding. Only if the user explicitly says to continue without it should you
register the tool without `collapseResult` and leave a TODO comment. A renderer built on an assumed response shape is
silently wrong and harder to spot than a verbose-but-correct full dump.

**Always verify new protocol-level code against the live IDE before declaring done.**
Unit tests use a hand-rolled fake server that may diverge from real-wire behaviour in
details the spec leaves ambiguous (e.g. line endings). The live IDE is the ground truth.

### `collapseResult` is a spec object, not a generic heuristic

`collapseResult` in `IdeaToolSpec` is a `CollapseSpec` with `summary` and optional
`expanded` render functions supplied by the caller (in `tool-specs.ts`), not a shared
parser that guesses structure from the raw text. Reason: response shapes differ enough
per tool that any shared heuristic would need per-tool knowledge anyway — so that
knowledge belongs in the spec where it is visible and unit-testable.

`list_directory_tree` is the clearest example of why a generic fallback fails: its
`tree` field is already a formatted text diagram; pretty-printing the outer JSON object
would be useless. Its `expanded` renderer returns `parsed.tree` directly.

The default expanded renderer (`prettyPrintContent`) is used only when the spec omits
`expanded`, which is the right choice for tools that return plain data objects.

### Debugger design decisions

**Security dialog scope:** Only `xdebug_start_debugger_session` (and `execute_run_configuration`)
trigger the JetBrains security dialog. `xdebug_set_breakpoint` does not — confirmed empirically
in < 5 ms in clean state. Earlier observations of `set_breakpoint` blocking were caused by a
stale dialog from a timed-out `start_debugger_session` call surfacing at the wrong moment.

**Dialog detection:** When `xdebug_start_debugger_session` blocks for > 3 s and
`xdebug_get_debugger_status` shows no sessions, the extension sets a `setWidget` warning
above the editor. The widget is cleared in `finally` so it disappears the moment the user
clicks Allow and the call returns. `ui.notify()` was rejected here because it is fire-and-forget
and cannot be withdrawn. The 3 s window distinguishes the dialog case from fast warm starts.

**`xdebug_set_variable` and `xdebug_run_to_line` are registered:** initially considered
"dangerous", but `set_variable` fails gracefully on immutable fields and `run_to_line` is
equivalent to "Run to Cursor". Don't remove them on safety grounds — the tool guidance
strings carry the API-level details (path format, return semantics, response shapes).

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
