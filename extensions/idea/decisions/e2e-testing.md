# E2E testing decisions

Read `extensions/idea/AGENTS.md` before this file.

## E2E tests (opt-in, drift detection)

**Mission:** catch JetBrains MCP drift (renamed tools, changed response shapes,
removed behaviours). **Not** a regression suite for extension logic — unit tests
cover that.

**Rules:**

- Separate suite: `npm run test:e2e`, never runs under `npm test`
- Never runs in CI; runs only when explicitly invoked by a developer
- Serial execution: no test parallelism for E2E (avoid fixture/connection collisions)
- Tests assert against extension outputs (see "Extension contract" in AGENTS.md), not raw MCP
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

## E2E tier plan

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
- Clean-up is best-effort. If the test process crashes mid-rename, how do we recover
  ghost symbols left in IDE indexes?
- vitest parallelism would let two tests collide on the same fixture filename. How do
  we serialize (file-level lock? UUID suffixes? `--no-file-parallelism`?)?
- The fixture lives in the developer's working copy. How do we communicate "this test
  mutates your tree, commit first" so it's impossible to miss?

Do not start Tier 3 until all five are answered.
