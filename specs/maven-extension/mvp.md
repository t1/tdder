# Maven pi Extension MVP

## Goal

Build a **pi extension for Maven** that adds active behavior beyond the existing Maven skill.
The MVP should help both the LLM and the user by:

- detecting Maven projects reliably
- running common Maven workflows correctly
- summarizing noisy Maven output into structured results
- looking up authoritative dependency versions from Maven Central

The MVP is **LLM-first**: tools and structured results matter more than interactive UI.
Human-facing commands should be thin wrappers over the same backend.

## Product Positioning

This extension should not be a generic shell wrapper around `mvn`.
pi already has `bash`, and this repo already has a Maven skill.
The extension is valuable only if it adds **Maven-specific intelligence and guardrails**.

## MVP Scope

### Core capabilities

1. **Maven project detection**
2. **Project/root/module/wrapper discovery**
3. **Structured Maven execution** for common actions
4. **Maven-aware execution rules** to avoid common mistakes
5. **Structured parsing of Maven results**
6. **Authoritative Maven Central version lookup by exact coordinates**

### Out of scope for MVP

- generic Maven artifact search by vague keyword
- dependency upgrade assistant
- automatic `pom.xml` editing
- effective POM analysis
- reactor resume / advanced `-rf` flows
- build performance diagnostics
- fancy custom TUI
- arbitrary Maven goal passthrough

## MVP Tools

### 1. `maven_project_info`

Returns structured information about the current Maven project.

#### Purpose

Foundational project detection and context gathering for both the LLM and user-facing commands.

#### Inputs

```json
{}
```

Optional future input:

```json
{
  "cwd": "optional override"
}
```

#### Behavior

- detect whether the current directory is inside a Maven project
- locate the effective project root
- detect whether `mvnw` / `mvnw.cmd` exists
- identify the Maven project owning the current working directory
- parse nested aggregator/module relationships into a project tree
- return a normalized project summary

#### Output

Example:

```json
{
  "isMavenProject": true,
  "projectRoot": "/path/to/project",
  "pomPath": "/path/to/project/pom.xml",
  "runner": "./mvnw",
  "currentProject": {
    "groupId": "com.acme",
    "artifactId": "service-a",
    "version": "1.0.0-SNAPSHOT",
    "packaging": "jar",
    "pomPath": "/path/to/project/services/service-a/pom.xml",
    "relativePath": "services/service-a",
    "plSelector": "services/service-a"
  },
  "projectTree": {
    "groupId": "com.acme",
    "artifactId": "root",
    "version": "1.0.0-SNAPSHOT",
    "packaging": "pom",
    "pomPath": "/path/to/project/pom.xml",
    "relativePath": ".",
    "children": [
      {
        "groupId": "com.acme",
        "artifactId": "services",
        "version": "1.0.0-SNAPSHOT",
        "packaging": "pom",
        "pomPath": "/path/to/project/services/pom.xml",
        "relativePath": "services",
        "children": [
          {
            "groupId": "com.acme",
            "artifactId": "service-a",
            "version": "1.0.0-SNAPSHOT",
            "packaging": "jar",
            "pomPath": "/path/to/project/services/service-a/pom.xml",
            "relativePath": "services/service-a",
            "plSelector": "services/service-a",
            "children": []
          }
        ]
      }
    ]
  }
}
```

#### MVP notes

- tree-shaped multi-module awareness is required
- `currentProject` exists so the extension can default runs to the Maven project owning the current `cwd`
- prefer path-based reactor selection such as `relativePath` / `plSelector` over plain `artifactId`
- this does **not** need full reactor analysis beyond the declared module tree

---

### 2. `maven_run`

Runs a constrained set of Maven workflows with Maven-specific rules.

#### Purpose

Provide a safe, structured alternative to raw `bash` for the most common Maven tasks.

#### Inputs

```json
{
  "action": "test | integration-test | verify | package",
  "project": "optional project path or plSelector",
  "selector": "optional test selector, e.g. MyTest or MyTest#method"
}
```

#### Supported actions

- `test`
- `integration-test`
- `verify`
- `package`

#### Command mapping

##### `test`

Use for unit tests.

Examples:
- no selector: `./mvnw test`
- class selector: `./mvnw test -Dtest=MyTest`
- method selector: `./mvnw test -Dtest='MyTest#myMethod'`

##### `integration-test`

Use for integration tests that should run via Failsafe.

Examples:
- class selector: `./mvnw verify -Dskip.surefire.tests -DskipITs=false -Dit.test=MyIT`
- method selector: `./mvnw verify -Dskip.surefire.tests -DskipITs=false -Dit.test='MyIT#myMethod'`

This should map to `verify`, not `test`.
The integration-test action must explicitly account for projects that set `skipITs=true` in a pom or parent pom.
For the common Failsafe case, the command should force `-DskipITs=false` so the requested ITs actually run.

##### `verify`

Use for full verification without special selector logic unless explicitly supported later.

Example:
- `./mvnw verify`

##### `package`

Use for building artifacts without tests.

Example:
- `./mvnw package -DskipTests`

#### Project selection handling

If `project` is specified, map it to Maven reactor selection with `-pl <project>`.
Prefer the path-like selector returned by `maven_project_info`, not just `artifactId`.

Example:
- `./mvnw -pl services/service-a test`

If `project` is omitted, default to `currentProject` from `maven_project_info` when the current `cwd`
is inside a child project; otherwise run from the reactor root.

MVP does not need sophisticated dependency-closure behavior.
Do not add `-am` automatically unless a concrete need emerges.

#### Execution rules

The tool must encode these rules:

- prefer `./mvnw` over `mvn` when available
- use `test` for unit tests
- use `verify` + failsafe flags for integration tests
- explicitly override `skipITs=true` with `-DskipITs=false` for the integration-test action
- quote selectors containing `#`
- use `package -DskipTests` for packaging intent
- avoid arbitrary goals in MVP
- return the exact command executed

#### Result parsing

The tool should summarize at least:

- success / failure
- `cwd`
- command executed
- test summary
- failed tests, preferably derived from Surefire/Failsafe reports when available
- compilation errors
- build/setup errors that occur before or outside test report generation
- surefire / failsafe summary
- report paths when discoverable
- `rawLogPath` pointing to the complete Maven console output saved under a project-local temp location such as `target/pi/maven-logs/...`

#### Output

Example success result:

```json
{
  "success": true,
  "cwd": "/path/to/project",
  "command": "./mvnw test -Dtest='MyTest#myMethod'",
  "action": "test",
  "testSummary": {
    "testsRun": 1,
    "failures": 0,
    "errors": 0,
    "skipped": 0
  },
  "failedTests": [],
  "compilationErrors": [],
  "buildErrors": [],
  "reportPaths": [
    "target/surefire-reports"
  ],
  "rawLogPath": "target/pi/maven-logs/2026-05-13T12-00-00-test.log"
}
```

Example failure result:

```json
{
  "success": false,
  "cwd": "/path/to/project/orders",
  "command": "./mvnw verify -Dskip.surefire.tests -DskipITs=false -Dit.test='OrderIT#shouldRetry'",
  "action": "integration-test",
  "testSummary": {
    "testsRun": 1,
    "failures": 1,
    "errors": 0,
    "skipped": 0
  },
  "failedTests": [
    {
      "className": "OrderIT",
      "methodName": "shouldRetry",
      "message": "expected 200 but was 503",
      "reportFile": "orders/target/failsafe-reports/TEST-OrderIT.xml"
    }
  ],
  "compilationErrors": [],
  "buildErrors": [],
  "reportPaths": [
    "orders/target/failsafe-reports"
  ],
  "rawLogPath": "target/pi/maven-logs/2026-05-13T12-01-00-integration-test.log"
}
```

#### Failure parsing strategy

- prefer structured parsing of Surefire/Failsafe XML reports for test failures
- fall back to Maven console output parsing when reports are absent, incomplete, or tests never started
- do not rely on raw output snippets as a primary result field
- persist the full raw Maven output to `rawLogPath` for human inspection instead of returning it in the LLM-facing tool content

#### Deliberate MVP limitation

Do **not** accept arbitrary goals or arbitrary `-D` properties in MVP.
That would dilute the value of the structured interface and turn the tool into shell passthrough.

---

### 3. `maven_lookup_version`

Looks up the latest authoritative version for an exact Maven coordinate.

#### Purpose

Prevent version hallucinations and stale dependency suggestions.
This is essential because dependency version selection is a frequent source of trouble.

#### Inputs

```json
{
  "groupId": "org.assertj",
  "artifactId": "assertj-core",
  "includePrereleases": false
}
```

#### Behavior

- fetch Maven metadata for the exact coordinate from Maven Central
- prefer authoritative metadata over search or generic web results
- return the latest available version plus the selected version after prerelease filtering
- if `includePrereleases` is `false`, filter out milestones, release candidates, betas, alphas, and snapshots if needed
- return source URL used for traceability

#### Output

Example:

```json
{
  "groupId": "org.assertj",
  "artifactId": "assertj-core",
  "latestVersion": "3.27.3",
  "selectedVersion": "3.27.3",
  "prereleaseFiltered": false,
  "metadataUrl": "https://repo1.maven.org/maven2/org/assertj/assertj-core/maven-metadata.xml"
}
```

#### Hard constraints

- use **exact coordinates only** in MVP
- use Maven Central metadata, not vague search
- no fallback to web search
- no upgrade planning
- no scanning the whole `pom.xml` for outdated dependencies in MVP

## User-Facing Command

### `/maven`

This command is optional but worthwhile for MVP if thinly implemented.
It should call the same backend logic as the tools above.

#### Suggested subcommands

- `/maven info`
- `/maven test [selector]`
- `/maven itest [selector]`
- `/maven verify`
- `/maven package`
- `/maven version <groupId>:<artifactId>`

#### `/maven info`

`/maven info` should be the human-facing view of `maven_project_info`.
It should not dump raw JSON or an unstructured gray text blob.

It should render a compact, readable project summary with clear visual structure:

- a title/status line such as `Maven project` or `Not a Maven project`
- project root
- runner (`./mvnw` vs `mvn`)
- current project for the current `cwd`
- a tree view of the Maven reactor/project hierarchy

Recommended presentation:

- highlight labels and important values rather than rendering everything as plain gray text
- indent the project tree to reflect nesting
- visually distinguish the `currentProject`
- keep the default view concise
- show additional details such as `pomPath`, `relativePath`, and `plSelector` only in expanded view if expandable rendering is used

Example collapsed view:

```text
Maven project
root: /repo
runner: ./mvnw
current: services/api
projects:
- root
  - services
    - service-api  [current]
```

If the current directory is not inside a Maven project, `/maven info` should say so clearly and tersely instead of showing empty placeholders.

#### Notes

- keep argument parsing simple
- do not add a complex wizard in MVP
- do not duplicate business logic in the command handler
- `/maven info` should reuse `maven_project_info` data and a dedicated renderer/formatter instead of building ad-hoc gray text inline

## UX Expectations

Minimal UX is enough for MVP:

- show a live progress widget while Maven is running (see below)
- display concise notifications for success/failure
- return structured tool results for LLM analysis
- in collapsed tool rendering, show only a concise summary
- in expanded tool rendering, show the complete Maven output loaded from `rawLogPath` so humans can inspect it on demand
- `/maven info` must render structured, readable project information instead of plain gray text

No custom TUI is required for the first version beyond the live progress widget, normal expandable tool rendering, and a dedicated readable renderer/formatter for `/maven info`.

### Live progress widget

While `maven_run` is executing, display a one-line widget above the editor using `ctx.ui.setWidget()`.
The widget is removed when Maven finishes; the tool result that follows makes it redundant.

Widget format:

```
⚙ Maven  12s  |  847 lines  |  [service-api] test
```

Fields:

- **elapsed time** — wall-clock seconds since Maven started, incremented by a timer
- **line count** — number of stdout/stderr lines received so far
- **current phase** — parsed from Maven output; starts as `resolving dependencies` and is
  overwritten as recognizable lines arrive

Update rate: throttled to ~5 fps (every 200 ms). Do not update on every line.

Phase parsing should recognize at minimum:

- `[INFO] Building <artifactId>` → update to `<artifactId>`
- `[INFO] --- <plugin>:<version>:<goal> (<id>) @ <artifactId> ---` → update to `[<artifactId>] <goal>`

The initial value before any recognizable line appears is `resolving dependencies`.
If Maven reaches a recognizable phase quickly, it is overwritten within the first update cycle.

## Safety and Reliability Principles

- prefer constrained tools over arbitrary shell execution
- expose exact command executed in every run result
- keep outputs structured and compact
- keep complete raw Maven output out of the LLM-facing tool content
- persist raw Maven output under a project-local temp location such as `target/pi/maven-logs/`
- never use secondary sources for artifact version lookup
- avoid feature creep into full dependency management

## Recommended MVP Shape

A strong MVP consists of exactly these three tools:

1. `maven_project_info`
2. `maven_run`
3. `maven_lookup_version`

Everything else should sit on top of those primitives or wait for a later version.

## Success Criteria

The MVP is successful if it can reliably do the following:

- detect a Maven project and choose `mvnw` when present
- render `/maven info` as a readable structured summary with project tree and current-project indication
- run unit tests correctly
- run integration tests correctly via `verify` / Failsafe conventions
- package artifacts correctly without running tests
- summarize Maven failures better than raw terminal output
- return authoritative latest versions for exact artifact coordinates
