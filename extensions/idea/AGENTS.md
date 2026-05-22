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
  decision that affects how all 8 v0.1 tools are wrapped

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

**Tier 1 (v0.1) — read-only, coarse assertions:**

- All 8 v0.1 tools called against the tdder project itself
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

**Tier 3 (v0.3+ at earliest) — mutation tests on file copies:**

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

### Unit tests (note on VCR pattern)

Unit tests for the MCP client layer may benefit from VCR-style recordings (record
real MCP responses once, replay in tests). Pros: deterministic, runs anywhere,
recordings document the wire format. Cons: recordings can go stale silently —
requires a manual re-record ritual when the plugin updates.

**Not** appropriate for E2E tests (they exist to catch the very drift VCR hides).
Consider for unit tests once hand-rolled mocks start feeling repetitive.

### `/idea open` macOS launcher: requires `-n`

On macOS, the working invocation is:

```bash
open -na "IntelliJ IDEA" --args "$PWD"
```

Counter-intuitively, `-n` (open a new instance) is **required** for IDEA to actually
open the project. Without `-n`, `open` just brings IDEA to the foreground and the
`--args` path is ignored — the project does not open. This contradicts what the
`open(1)` man page implies, because IDEA's launcher inside the app bundle handles
args differently from a generic macOS app.

IDEA itself still de-duplicates: if the project is already open in an existing
instance, `open -na ... --args "$PWD"` activates that instance instead of spawning
a second window. So `-n` does **not** create competing IDE processes in practice.

Do not "simplify" by removing `-n` — it has been tested empirically and `-n` is
required.

### TDD discipline

Follow the `tdd` skill. HITL is `off` at the repo level, so cycles run autonomously
and report at the end. Baby steps still apply — never bundle two test cycles.

## v0.1 scope reminder

See `README.md` (repo root) "idea" extension section for the full v0.1 TODO list.
TL;DR: 8 read-only `explore/code` tools, lazy MCP connect, footer status with three
states, `/idea status` slash command, `projectPath` auto-injection.

Do **not** add v0.2+ functionality until v0.1 is shipped and exercised.
