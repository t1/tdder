---
name: maven
description: >
  Always load this skill when a pom.xml file exists in the project, when creating or editing a
  pom.xml, or when setting up Maven project structure in a new project. It provides Maven-specific
  conventions for running tests, building, managing dependencies, and project structure.
version: 0.1.0
---

# Maven

Shared Maven conventions for all supported agent platforms.

**First step — always:** read your platform binding before running Maven, suggesting Maven
commands, or giving sandbox advice.

## Platform Bindings

**Read your platform file before doing anything else.**

- If `maven_run` is in your tool list: read `skills/maven/pi.md` (relative to the skill checkout)
- Otherwise: read `skills/maven/claude.md` (relative to the skill checkout)

Your platform file defines the concrete tools, fallback order, and sandbox/network rules.
The rest of this file is shared Maven knowledge.

# Managing POMs

## Dependencies

When adding a new dependency:

- Use the latest stable release version — verify with version lookup (see below)
- Choose the appropriate scope (`compile`, `provided`, `runtime`, `test`) and keep them sorted by scope
- Prefer managed versions via `<dependencyManagement>` in the parent POM

Version properties typically follow the pattern `<artifactId.version>` or `<groupId.version>`,
but use whatever is most concise and clear, e.g. `assertj.version`, `cucumber.version`, `junit.version`.

## Version Lookup

Always fetch from Maven Central (or another authoritative repository) to verify the latest dependency or plugin version.
Never trust version numbers from web search snippets, training data, or other secondary sources.

Use your platform binding's version-lookup tool first.

If that is not available, directly use the Maven repository metadata as a last resort.
DO NOT USE search.maven.org — it's obsolete and returns outdated versions!
Note: repo1.maven.org returns 403 for User-Agents that look like AI or crawlers.
In sandboxed environments the sandbox may block `curl` — tell the user if that happens.

```bash
curl -s -A "Mozilla/5.0" \
  "https://repo1.maven.org/maven2/{groupId with . replaced by /}/{artifactId}/maven-metadata.xml"
```

These XML files contain the list of all versions. You'll have to strip pre-release versions, `RC`, `beta`, etc.

## Exploring APIs of Dependencies

When you need to find out how a dependency's API works (method signatures, builder methods,
interface contracts), use IDE tools (`get_symbol_info`, `search_symbol`) or the `jdtls-lsp`
(`goToDefinition`, et al.). Both already index all dependencies and provide richer context
including documentation and declarations. If neither are available, suggest to the user to
install one or the other, including a short how-to.

### Manual API Exploring Fallback

Only if the user denies more sophisticated tooling, fall back to working manually
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

If the source JAR is not available, use your platform's preferred Maven execution path to run
`dependency:get -Dartifact=org.example:my-lib:2.3.1:jar:sources`.
Only if there is no source available in the Maven repo, use `javap` to decompile the `jar` file as a last resort.

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

Use your platform binding's Maven execution path first. It defines the concrete tool or CLI,
how to pass profiles, and when raw `mvn` fallback is allowed.

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

If you can't use better tooling and have to run tests via raw Maven,
always quote `-Dtest` values containing `#` (method selectors) — unquoted `#` is parsed as
a shell comment:

```bash
mvn test
mvn test -Dtest=VersionTest
mvn test -Dtest='MyTest#myMethod'
```

# Building

Normally, `clean` is **not** necessary. Prefer incremental Maven builds/tests first.
Reaching for `clean` by default only makes feedback slower and can hide the real problem.

But be ready to recognize stale build output:

- a test or runtime failure mentions a class that no longer has matching source code
- a class/resource was renamed, moved, or deleted, but old behaviour still shows up
- failures appear "impossible" compared to the current sources

In those cases, check whether the referenced class actually still exists in `src/main` or `src/test`.
If it doesn't, a stale class file in `target/` is a likely cause; then a `clean` build is justified.

Use your platform binding's Maven execution path first for packaging.
If every agent-oriented option is unavailable, fall back to:

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
