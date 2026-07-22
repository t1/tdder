# Quarkus extension

Integrates [quarkus-agent-mcp](https://github.com/quarkusio/quarkus-agent-mcp) into pi so the LLM can manage Quarkus projects and dev-mode workflows through native `quarkus_*` tools.

## Bootstrap and tool activation

`quarkus_bootstrap` is a bootstrap-only tool for empty or non-Quarkus Maven projects.
It creates the minimal `pom.xml` needed for Quarkus tooling to activate.

On success it does not stop at writing `pom.xml`. Within the same tool call it also:

- starts `quarkus-agent-mcp`, which registers the normal `quarkus_*` tool set via `pi.registerTool`, and
- toggles the active tool set via `pi.setActiveTools`: removes `quarkus_bootstrap` and adds the freshly registered `quarkus_*` tools.

Newly registered tools are callable on the next turn in the same session — there is no need to recreate or reload the session. The `quarkus` extension does not know about `unfolding` or any session-ending tool; it only activates its own tool set.

## Supported JDK lookup

The extension also registers a native `quarkus_latest_supported_jdk` tool.

It determines the current Quarkus version from the project's `pom.xml` or `build.gradle(.kts)` unless one is passed explicitly, reduces it to the `major.minor` series, then fetches:

- `https://raw.githubusercontent.com/quarkusio/quarkus/refs/heads/<major.minor>/.github/workflows/ci-actions-incremental.yml`

From that workflow it reads `jobs.maven-tests.strategy.matrix.java.*.java-version` and reports the maximum configured JDK as the latest supported JDK for that Quarkus line.
