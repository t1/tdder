# Maven pi Extension Test Strategy

## Goal

Create a test strategy that supports **real TDD** for the Maven pi extension.
The strategy must give fast feedback for core logic while still covering the pi-specific integration points.

## Guiding Principle

Do **not** treat manual loading of pi as the primary test approach.
That is only smoke testing.

The extension should be designed so that most behavior is testable without an interactive terminal.
The pi layer should stay thin, with the bulk of the logic implemented in testable modules.

## Test Pyramid

Use three layers of tests:

1. **Unit tests** for pure logic
2. **Subprocess integration tests** for pi contract behavior
3. **Minimal manual / PTY smoke tests** for interactive terminal-specific behavior

The vast majority of tests should live in layers 1 and 2.

---

## 1. Unit Tests

### Purpose

Cover deterministic logic with fast, focused tests that fit the TDD red-green-refactor cycle.

### Scope

Unit tests should cover at least:

- Maven Central metadata URL construction
- Maven Central metadata parsing
- prerelease filtering
- nested Maven project tree parsing from `pom.xml`
- current-project detection from `cwd`
- Maven command building for supported actions
- test selector quoting
- `skipITs=false` override behavior
- Surefire/Failsafe XML parsing
- compilation error extraction from Maven output
- build/setup error extraction from Maven output
- log path generation
- tool result rendering logic in collapsed vs expanded mode
- `/maven info` formatting/rendering logic, including tree indentation and current-project highlighting
- live progress widget phase parsing:
  - initial state shows `resolving dependencies`
  - `[INFO] Building <artifactId>` updates the phase to `<artifactId>`
  - `[INFO] --- <plugin>:<version>:<goal> (<id>) @ <artifactId> ---` updates the phase to `[<artifactId>] <goal>`
  - unrecognized lines leave the phase unchanged
- live progress widget line: correct format of elapsed time, line count, and phase fields

### Test style

- Prefer fixture-driven tests over mocks
- Keep functions pure where possible
- Mock only external boundaries such as HTTP, process execution, and current time

### Fixtures

Use real sample files for:

- `maven-metadata.xml`
- nested `pom.xml` trees
- Surefire/Failsafe XML reports
- representative Maven console output

These should live in a dedicated fixture directory.

Example structure:

```text
extensions/maven/
  test/
    fixtures/
      metadata/
      projects/
      reports/
      console-output/
```

---

## 2. Subprocess Integration Tests

### Purpose

Verify that the extension works correctly when loaded by pi, without requiring full visual TUI automation.

### Key principle

Prefer **machine-readable subprocess testing** over terminal scraping.
Use pi in non-interactive or RPC-oriented modes when possible.

### What these tests should verify

#### Extension loading

- pi can load the extension successfully
- the expected tools are registered
- the expected command(s) are registered

#### `maven_lookup_version`

- the tool can be invoked through pi
- the tool returns the expected structured result
- prerelease filtering behavior is correct

#### `maven_project_info`

- the tool works in fixture projects
- nested project trees are returned correctly
- `currentProject` is resolved correctly
- wrapper detection works

#### `/maven info`

- the command renders a structured readable summary rather than an unformatted gray text blob
- the project tree is shown with nesting preserved
- the current project is visually distinguishable
- the non-Maven case is reported tersely and clearly

#### `maven_run`

- the tool can be invoked through pi
- the result contains compact LLM-facing fields only
- `rawLogPath` is returned
- the raw log file exists on disk
- the raw log file contains the complete Maven output
- the raw Maven output is **not** returned in LLM-facing tool `content`

#### UI-only behavior via RPC-style assertions

Where pi exposes extension UI requests in a structured way, assert that:

- a widget is set above the editor when Maven starts
- the widget is cleared when Maven finishes
- completion/failure notifications are emitted

### Why subprocess tests matter

They verify the real extension boundary:

- resource discovery
- tool registration
- pi invocation contract
- filesystem interactions
- LLM-facing result shape

Without these tests, the extension may have correct internals but still fail when actually loaded by pi.

---

## 3. Minimal Manual / PTY Smoke Tests

### Purpose

Cover the tiny set of behaviors that are truly interactive-terminal specific.

### Scope

Keep this layer very small.
It should only cover behavior that cannot be validated well by unit tests or subprocess contract tests.

Candidate smoke checks:

- collapsed tool view shows a concise summary
- expanded tool view shows the full Maven log from `rawLogPath`
- expand/collapse interaction works in an actual terminal session
- `/maven info` is visually readable in the real TUI and does not degrade into flat gray text

### Warning

Do **not** rely on PTY/screen-scraping tests as the main automated strategy.
They are brittle, slow, and hostile to TDD.

If one PTY smoke test is added later, treat it as an acceptance check, not as the core safety net.

---

## TDD Workflow

### Scope TDD to one tool at a time

Do not start with the whole extension.
Use the TDD skill on one narrow slice at a time.

Recommended order:

1. `maven_lookup_version`
2. `maven_project_info`
3. `maven_run`

This order starts with the smallest, cleanest behavior and builds confidence incrementally.

### Red-Green-Refactor target

The primary TDD loop should target:

- pure functions first
- then thin integration seams
- then subprocess contract checks

Do not start a TDD cycle with interactive TUI behavior.
That is too slow and too broad.

---

## Recommended Test Infrastructure

### Test runner

Use the smallest viable setup:

- `node:test`
- `tsx`

Why:

- minimal dependency footprint
- enough for fixture-based tests
- enough for subprocess execution
- aligns with the project goal of staying lean

### Directory layout

Recommended structure:

```text
extensions/maven/
  index.ts
  project-info.ts
  maven-run.ts
  version-lookup.ts
  report-parser.ts
  log-store.ts
  types.ts
  test/
    fixtures/
      metadata/
      projects/
      reports/
      console-output/
    version-lookup.test.ts
    project-info.test.ts
    maven-run-command.test.ts
    report-parser.test.ts
    renderer.test.ts
    pi-integration.test.ts
```

### Why modularity matters

If the extension is built as one large pi-specific file, TDD will degrade into awkward integration testing.

To make TDD practical, keep `index.ts` thin and move logic into small modules.

---

## Fixture Strategy

### Metadata fixtures

Provide Maven Central examples for:

- normal stable release
- latest version is an RC
- snapshot/malformed edge cases
- missing release element

### Project fixtures

Provide example Maven projects for:

- single-module project
- flat multi-module project
- nested aggregator tree
- wrapper present
- wrapper absent

### Report fixtures

Provide Surefire/Failsafe examples for:

- passing test suite
- single failed test
- test error
- no tests run

### Console output fixtures

Provide Maven output samples for:

- compilation failure
- dependency resolution failure
- plugin/build setup failure
- test failure with incomplete report generation

---

## Rendering Strategy

### What to test

Test rendering logic directly rather than through the terminal when possible.

The collapsed/expanded result behavior should be testable as pure rendering logic:

- collapsed: concise summary only
- expanded: full log loaded from `rawLogPath`

The `/maven info` presentation should also be tested as rendering/formatting logic:

- labels are visually distinguished from values
- tree nesting is preserved
- current-project highlighting is applied
- the non-Maven case is concise and explicit

### Why this is important

The extension requirement is:

- humans can inspect full Maven output on demand
- the raw output must not enter the LLM context

This is best validated by:

- unit tests for renderer behavior
- subprocess tests for result shape and log persistence

not by heavy visual TUI automation.

---

## LLM Context Safety Tests

The strategy must explicitly verify that raw Maven output does not leak into the LLM-facing result.

For `maven_run`, tests should assert:

- `content` contains only compact summary information
- `details` contains only metadata such as `rawLogPath`, report paths, and parsed structures
- the complete raw console output is persisted only in the log file
- expanded rendering reads from `rawLogPath` rather than embedding the full raw output in the result payload

This is a core acceptance criterion, not a nice-to-have.

---

## Proposed Milestones

### Milestone 1 — test harness proof

Establish the test runner and prove that:

- TypeScript tests run
- fixtures can be loaded
- pi can be launched in a subprocess for one simple integration assertion

### Milestone 2 — `maven_lookup_version`

Add unit tests first, then one subprocess contract test.

### Milestone 3 — `maven_project_info`

Add fixture-driven tests for tree parsing and current-project detection, then one subprocess contract test.
Also add focused renderer/formatter tests for `/maven info` before relying on any manual TUI check.

### Milestone 4 — `maven_run`

Build in slices:

1. command construction
2. raw log persistence
3. basic success/failure result shape
4. report parsing
5. collapsed/expanded rendering
6. live progress widget (phase parser unit tests first, then widget integration)
7. subprocess contract tests

### Milestone 5 — optional interactive smoke check

Only after the above is stable, decide whether one PTY smoke test for expand/collapse is worth the maintenance cost.

---

## Definition of Done

The testing strategy is successful when:

- most extension behavior is covered by fast unit tests
- pi integration is covered by subprocess contract tests
- full raw Maven output is available for humans on demand
- raw Maven output is kept out of the LLM-facing result
- manual testing is reduced to a very small smoke-check layer
- TDD cycles remain fast enough to be practical
