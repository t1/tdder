---
name: maven
description: >
  This skill should be used when working on Maven projects and the user asks to "run tests",
  "build the project", "run a specific test", or when TDD or clean code skills are active in a
  project containing a pom.xml file. Provides Maven-specific conventions that complement the
  language-agnostic TDD and clean code skills.
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

Use `central.sonatype.com` for Maven artifact searches, **not** `search.maven.org` (obsolete).
All dependency versions — including frameworks like Quarkus — are published to Maven Central.
Always fetch the actual Maven Central page to verify the latest version. Never trust version
numbers from web search snippets or other secondary sources.

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
