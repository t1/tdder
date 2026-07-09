# Maven — Claude Bindings

## Tool Order

Prefer agent-oriented tools in this order:

1. `maven_run` if available
2. `tdder-maven`
3. raw `mvn`

If `maven_run` is available, prefer it over raw `mvn` — it enforces correct flags,
parses Surefire/Failsafe XML reports, and returns a compact structured result.

If `maven_run` is not available, run `tdder-maven help` to learn the syntax and examples,
then use it. If that also fails (command not found or your use-case is not supported),
fall back to raw `mvn`.

**TRYING TO USE AGENT-ORIENTED TOOLS IS MANDATORY**. Don't use `mvn` without having tried,
or because you consider the job too small.

## Project Info

Use `maven_project_info` if available.

If not available, use the CLI via bash: `tdder-maven info`.

If that's also not available, look into the `<modules>` elements of the root pom and recurse
into the directories' poms.

## Version Lookup

Use `maven_lookup_version` if available.

Otherwise use the CLI:

```bash
tdder-maven lookup-version org.assertj assertj-core
tdder-maven lookup-version io.quarkus quarkus-bom --include-prereleases
```

## Downloading New Dependencies (Claude Code Sandbox)

The sandbox blocks DNS, so Maven may be unable to download new dependencies. When Maven fails with
a DNS/network error like `nodename nor servname provided, or not known`,
you may use `dangerouslyDisableSandbox: true` — but **ONLY** for `dependency:resolve`.

**NEVER** disable the sandbox for builds, tests, or plugin goals — it prevents arbitrary
code execution by build plugins and test code. Always split into two steps:

```bash
# Step 1: resolve dependencies with sandbox disabled — ONLY this goal
Bash(command: "mvn dependency:resolve", dangerouslyDisableSandbox: true)

# Step 2: run the actual build/test IN the sandbox
Bash(command: "mvn test")
```

## Running Tests

Use `maven_run` with `action="test"` if available.
If not, use `tdder-maven test --scope --profiles`.
Only if neither is available, use raw `mvn`.

## Testcontainers (Claude Code Sandbox)

Maven with Testcontainers (Docker-based tests) requires sandbox configuration. Three problems
must be solved:

**1. Temp files** — Maven, Surefire, and Quarkus all create temp files. Redirect `java.io.tmpdir`
to `target` for both the Maven JVM and forked test JVMs:

- **Maven JVM**: set `MAVEN_OPTS="-Djava.io.tmpdir=target"` in `.claude/settings.local.json` `env`
- **Forked JVMs** (Surefire/Failsafe): set `<argLine>` in the plugin config:
  ```xml
  <argLine>-Djava.io.tmpdir=${project.build.directory}</argLine>
  ```
- **Native code** (e.g. jansi): set `TMPDIR=target` in `.claude/settings.local.json` `env`

**2. Docker socket** — On macOS, Docker Desktop exposes two socket paths. The sandbox must
allow both:

```json
"allowUnixSockets": [
    "/var/run/docker.sock",
    "~/.docker/run/docker.sock"
]
```

`/var/run/docker.sock` is often a symlink to `~/.docker/run/docker.sock`;
the sandbox resolves symlinks, so both paths are needed.

**3. Localhost TCP** — Testcontainers connects to started containers via `localhost:<random-port>`.
Enable this with:

```json
"allowLocalBinding": true,
"allowedDomains": ["localhost"]
```

If Docker images are not cached locally, also add `"registry-1.docker.io"` to `allowedDomains`.

## Building

Use `maven_run` with `action="package"` if available.
If not, use `tdder-maven package --profiles`.
Only if neither is available, use raw `mvn`.
