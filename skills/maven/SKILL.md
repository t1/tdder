---
name: maven
description: >
  Always load this skill when a pom.xml file exists in the project. It provides Maven-specific
  conventions for running tests, building, managing dependencies, and project structure that
  complement the language-agnostic TDD and clean code skills.
version: 0.1.0
---

# Maven Conventions

Maven-specific conventions complementing the TDD and Clean Code skills.

## Running Tests

### All Unit Tests

```bash
mvn test
```

### Specific Unit Test

```bash
mvn test -Dtest=VersionTest
```

### Specific Integration Test (no unit tests)

```bash
mvn -Dskip.surefire.tests -Dit.test=CheckCommandIT verify
```

### Build Without Tests

```bash
mvn package -DskipTests
```

### Shell Quoting

Always quote Maven `-Dtest` values containing `#` (method selectors):

```bash
# Correct — hash is quoted
mvn test -Dtest='MyTest#myMethod'

# Wrong — unquoted # is parsed as a shell comment
mvn test -Dtest=MyTest#myMethod
```

## Maven Central

All dependency versions — including frameworks like Quarkus — are published to Maven Central.
Always fetch from the actual Maven Central to verify the latest version. Never trust version
numbers from web search snippets or other secondary sources.

Use `WebFetch` to look up artifact versions on central.sonatype.com:

```
WebFetch(url: "https://central.sonatype.com/artifact/{groupId}/{artifactId}", prompt: "What is the latest version?")
```

For example, to find the latest version of `org.assertj:assertj-core`:

```
WebFetch(url: "https://central.sonatype.com/artifact/org.assertj/assertj-core", prompt: "What is the latest stable version? Ignore milestones, alphas, betas, and RCs.")
```

DO NOT USE search.maven.org! It's obsolete and returns outdated versions!!!
DO NOT USE `curl` to fetch from repo1.maven.org — the sandbox blocks it.

## Project Structure

### Standard Layout

```
src/
├── main/java/          # Production code
├── main/resources/     # Production resources
├── test/java/          # Unit tests
└── test/resources/     # Test resources
```

## System Tests

System Tests (STs) are named `*ST.java`. This naming is not matched by
Surefire's default includes (`**/Test*.java`, `**/*Test.java`,
`**/*Tests.java`, `**/*TestCase.java`), so no Surefire exclusion is needed.

STs run via the Failsafe plugin (post-packaging) in a dedicated profile:

```xml
<profile>
    <id>st</id>
    <build>
        <plugins>
            <plugin>
                <groupId>org.apache.maven.plugins</groupId>
                <artifactId>maven-failsafe-plugin</artifactId>
                <configuration>
                    <includes>
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
        </plugins>
    </build>
</profile>
```

Run STs with: `mvn verify -Pst`

## Running Maven in the Claude Code Sandbox

### Downloading new dependencies

The sandbox blocks DNS resolution for processes spawned by Bash, so Maven
cannot download new dependencies from the internet. When Maven fails with
a DNS/network error like `nodename nor servname provided, or not known`,
retry the command with `dangerouslyDisableSandbox: true`.

Prefer a targeted `dependency:resolve` over re-running the full build
without sandbox:

```bash
# First: resolve dependencies with sandbox disabled
Bash(command: "mvn dependency:resolve", dangerouslyDisableSandbox: true)

# Then: run the actual build/test in the sandbox
Bash(command: "mvn test")
```

### Testcontainers

Maven with Testcontainers (Docker-based tests) requires sandbox configuration
to work. Three problems must be solved:

### 1. Temp files

Maven, Surefire, and Quarkus all create temp files. Redirect `java.io.tmpdir`
to `target/tmp` for both the Maven JVM and forked test JVMs:

- **Maven JVM**: set `MAVEN_OPTS="-Djava.io.tmpdir=target/tmp"` in
  `.claude/settings.local.json` `env`
- **Forked JVMs** (Surefire/Failsafe): set `<argLine>` in the plugin config:
  ```xml
  <argLine>-Djava.io.tmpdir=${project.build.directory}/tmp</argLine>
  ```
- **Native code** (e.g. jansi): set `TMPDIR=target/tmp` in
  `.claude/settings.local.json` `env`
- **Directory creation**: add a `SessionStart` hook to run `mkdir -p target/tmp`

### 2. Docker socket

On macOS, Docker Desktop exposes two socket paths. The sandbox must allow both:

```json
"allowUnixSockets": [
    "/var/run/docker.sock",
    "~/.docker/run/docker.sock"
]
```

`/var/run/docker.sock` is often a symlink to `~/.docker/run/docker.sock`;
the sandbox resolves symlinks, so both paths are needed.

### 3. Localhost TCP

Testcontainers connects to started containers via `localhost:<random-port>`.
Enable this with:

```json
"allowLocalBinding": true,
"allowedDomains": ["localhost"]
```

If Docker images are not cached locally, also add `"registry-1.docker.io"`
to `allowedDomains`.

## POM Conventions

### Dependencies

Dependencies are declared in `pom.xml`. When adding a new dependency:

- Use the latest stable release version (double check with Maven Central)
- Choose the appropriate scope (`compile`, `provided`, `runtime`, `test`) and keep them sorted by their scope
- Prefer managed versions via `<dependencyManagement>` in parent POMs

### Properties

Version properties follow the pattern `<artifactId.version>` or `<groupId.version>`.

## Resolving Dependency Sources

To read the source code of a dependency, locate its sources JAR in the local Maven repository:

```
~/.m2/repository/{groupId with '.' replaced by '/'}/{artifactId}/{version}/{artifactId}-{version}-sources.jar
```

For example, `org.example:my-lib:2.3.1` resolves to:
`~/.m2/repository/org/example/my-lib/2.3.1/my-lib-2.3.1-sources.jar`

### Finding the correct version

- For direct dependencies: check the project's `pom.xml` `<dependencies>` section.
- For transitive dependencies: use `mvn dependency:tree` because the resolution rules are complex.
- Always use the version matching the project's dependency tree, not whatever SNAPSHOT etc. happens to be cached.

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

## JDT and Maven Output Isolation

If the jdtls plugin (based on the Eclipse JDT, which is used by VS Code Java, Eclipse IDE)
then **Always check**: `.settings/org.eclipse.jdt.core.prefs` compiler compliance matches the
pom's `maven.compiler.source`/`maven.compiler.target`. A mismatch (e.g., JDT on Java 17,
pom on Java 21) causes JDT to flag valid API calls as errors.

And it can compile into the same `target/classes` directory as Maven. This causes intermittent build failures:

- **Symptom**: `java.lang.Error: Unresolved compilation problems` at runtime, despite
  `mvn compile` succeeding (says "Nothing to compile — all classes are up to date")
- **Root cause**: JDT overwrites Maven's class files. Maven sees the newer class and skips
  recompilation. JDT's class files embed errors as runtime throws (unlike javac, which
  fails at compile time).
- **Fix**: Ensure `.classpath` output paths don't overlap with Maven's `target/classes`:
  ```xml
  <classpathentry kind="output" path="target/eclipse-classes"/>
  ```

## Resolving Dependency APIs

When you need to find out how a dependency's API works (method signatures, builder methods, interface contracts), use
IDE tools (`get_symbol_info`, `search_symbol`) or the `jdtls-lsp` (`goToDefinition`, et.al.) instead of manually
decompiling jars with `javap` or reading files from `~/.m2/repository`. Both already index all dependencies and
provide richer context including documentation and declarations. If neither are available, suggest to the user to
install one or the other, including a short how-to. Only if the user denies, fall back to working manually.
