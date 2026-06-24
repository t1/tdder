---
name: maven
description: >
  Always load this skill when a pom.xml file exists in the project. It provides Maven-specific
  conventions for running tests, building, managing dependencies, and project structure.
version: 0.1.0
---

Prefer `maven_run` over raw `mvn` — it enforces correct flags, parses Surefire/Failsafe
XML reports, and returns a compact structured result, so it actually hurts to use `tail` et.al.
on the output. Its usage examples are in the tool's guidelines and are available
when the pi extension is loaded.

If `maven_run` is not available, run `tdder-maven help` to learn the syntax and examples,
then use it. If that also fails (command not found or your use-case is not supported),
fall back to raw `mvn`.

**TRYING TO USE AGENT ORIENTED TOOLS IS MANDATORY**! Don't use `mvn` without having tried,
or because you consider the job too small.

# Project Info

Use `maven_project_info` (pi extension) to get the project structure, module tree, and runner.

If not available, use the CLI via bash: `tdder-maven info`.

If that's also not available, look into the `<modules>` elements of the root pom and recurse
into the directories' poms.

# Managing POMs

## Dependencies

When adding a new dependency:

- Use the latest stable release version — verify with version lookup (see below)
- Choose the appropriate scope (`compile`, `provided`, `runtime`, `test`) and keep them sorted by scope
- Prefer managed versions via `<dependencyManagement>` in the parent POM

Version properties typically follow the pattern `<artifactId.version>` or `<groupId.version>`,
but use whatever is most concise and clear, e.g. `assertj.version`, `cucumber.version`, `junit.version`.

## Version Lookup

Always fetch from Maven Central (or other repository) to verify the latest dependency or plugin version.
Never trust version numbers from web search snippets, training data, or other secondary sources.

Use `maven_lookup_version` (pi extension) if available.

Otherwise use the CLI:

```bash
tdder-maven lookup-version org.assertj assertj-core
tdder-maven lookup-version io.quarkus quarkus-bom --include-prereleases
```

If neither is available, directly use the maven repository metadata as a last resort.
DO NOT USE search.maven.org — it's obsolete and returns outdated versions!
Note: repo1.maven.org returns 403 for User-Agents that look like AI or crawlers.
In sandboxed environments (e.g. Claude Code) the sandbox may block `curl` — tell the user if that happens.

```bash
curl -s -A "Mozilla/5.0" \
  "https://repo1.maven.org/maven2/{groupId with . replaced by /}/{artifactId}/maven-metadata.xml"
```

These xml files contain the list of all versions. You'll have to strip pre-release versions, `RC`, `beta`, etc.

## Exploring APIs of Dependencies

When you need to find out how a dependency's API works (method signatures, builder methods,
interface contracts), use IDE tools (`get_symbol_info`, `search_symbol`) or the `jdtls-lsp`
(`goToDefinition`, et al.). Both already index all dependencies and provide richer context
including documentation and declarations. If neither are available, suggest to the user to
install one or the other, including a short how-to.

### Manual API Exploring Fallback

Only if the user denies to use more sophisticated tooling, fall back to working manually
and read the source code of an artefact manually. Locate the sources JAR in the local Maven repository:

```
~/.m2/repository/{groupId with '.' replaced by '/'}/{artifactId}/{version}/{artifactId}-{version}-sources.jar
```

For example, `org.example:my-lib:2.3.1` resolves to:
`~/.m2/repository/org/example/my-lib/2.3.1/my-lib-2.3.1-sources.jar`

To find the correct version:

- For direct dependencies: check the project's `pom.xml` `<dependencies>` section.
- For transitive dependencies: use `mvn dependency:tree` — resolution rules are complex.
- Always use the version matching the project's dependency tree, not whatever happens to be cached.

If the source-jar is not available, run `mvn dependency:get -Dartifact=org.example:my-lib:2.3.1:jar:sources`
Only if there is no source available in the maven repo, use `javap` to decompile the `jar` file as a last resort.

## Downloading New Dependencies (Claude Code Sandbox)

The sandbox blocks DNS, so Maven cannot download new dependencies. When Maven fails with
a DNS/network error like `nodename nor servname provided, or not known`,
use `dangerouslyDisableSandbox: true` — but **ONLY** for `dependency:resolve`.

**NEVER** disable the sandbox for builds, tests, or plugin goals — it prevents arbitrary
code execution by build plugins and test code. Always split into two steps:

```bash
# Step 1: resolve dependencies with sandbox disabled — ONLY this goal
Bash(command: "mvn dependency:resolve", dangerouslyDisableSandbox: true)

# Step 2: run the actual build/test IN the sandbox
Bash(command: "mvn test")
```

## Preview Features

If the project uses Java preview features, pass `--enable-preview` when running:

```bash
java --enable-preview -jar target/artifact.jar
```

This is typically configured in the Maven compiler plugin:

```xml

<plugin>
    <groupId>org.apache.maven.plugins</groupId>
    <artifactId>maven-compiler-plugin</artifactId>
    <configuration>
        <enablePreview>true</enablePreview>
    </configuration>
</plugin>
```

# Running Tests

Use `maven_run` with `action="test"`. If not available, use `tdder-maven test --scope`.
If neither is available, use raw `mvn` (see below).

## Integration/System/Acceptance/E2E Tests

Tests that require a running service or a built jar file **must** use the Failsafe plugin, not Surefire:
jars are not built in the `test` phase where Surefire is executing,
and `*IT.java` files are not picked up by Surefire's default includes.
Add the Failsafe plugin to the pom (including the execution goals; see below)
and execute them on the `verify` lifecycle.

`*ST.java` and `*AT.java` don't match Failsafe's default includes either, so add them explicitly when required:

```xml

<plugin>
    <groupId>org.apache.maven.plugins</groupId>
    <artifactId>maven-failsafe-plugin</artifactId>
    <configuration>
        <includes>
            <include>**/*IT.java</include>
            <include>**/*AT.java</include>
            <include>**/*ST.java</include>
        </includes>
    </configuration>
    <executions>
        <execution>
            <goals>
                <goal>integration-test</goal>
                <goal>verify</goal>
            </goals>
        </execution>
    </executions>
</plugin>
```

## Raw `mvn` Fallback

If you can't use a better tooling to run tests and have to run them via maven command,
always quote `-Dtest` values containing `#` (method selectors) — unquoted `#` is parsed as
a shell comment:

```bash
mvn test
mvn test -Dtest=VersionTest
mvn test -Dtest='MyTest#myMethod'
```

### Testcontainers (Claude Code Sandbox)

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

# Building

Normally, `clean` is **not** necessary. Prefer incremental Maven builds/tests first.
Reaching for `clean` by default only makes feedback slower and can hide the real problem.

But be ready to recognize stale build output:

- a test or runtime failure mentions a class that no longer has matching source code
- a class/resource was renamed, moved, or deleted, but old behaviour still shows up
- failures appear "impossible" compared to the current sources

In those cases, check whether the referenced class actually still exists in `src/main` or `src/test`.
If it doesn't, a stale class file in `target/` is a likely cause; then a `clean` build is justified.

Use `maven_run` with `action="package"`. If not available, use `tdder-maven package`.
If neither is available:

```bash
mvn package -DskipTests
```

## JDT and Maven Output Isolation

If the jdtls plugin (based on Eclipse JDT, used by VS Code Java and Eclipse IDE) is active,
**always check** that `.settings/org.eclipse.jdt.core.prefs` compiler compliance matches the
POM's `maven.compiler.source`/`maven.compiler.target`. A mismatch (e.g. JDT on Java 17, POM
on Java 21) causes JDT to flag valid API calls as errors.

JDT can also compile into the same `target/classes` directory as Maven, causing intermittent
build failures:

- **Symptom**: `java.lang.Error: Unresolved compilation problems` at runtime, despite
  `mvn compile` succeeding ("Nothing to compile — all classes are up to date")
- **Root cause**: JDT overwrites Maven's class files. Maven sees the newer timestamp and skips
  recompilation. JDT's class files embed errors as runtime throws (unlike javac, which fails
  at compile time).
- **Fix**: Ensure `.classpath` output paths don't overlap with Maven's `target/classes`:
  ```xml
  <classpathentry kind="output" path="target/eclipse-classes"/>
  ```
