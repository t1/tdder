---
name: Maven Conventions
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

## Project Structure

### Standard Layout

```
src/
├── main/java/          # Production code
├── main/resources/     # Production resources
├── test/java/          # Unit tests
└── test/resources/     # Test resources
```

### Package Documentation

Use `package-info.java` files for package-level documentation and architecture.
Always read the relevant `package-info.java` files to understand the architecture,
patterns, and conventions for a package before modifying code within it.

## POM Conventions

### Dependencies

Dependencies are declared in `pom.xml`. When adding a new dependency:

- Use the latest stable release version
- Choose the appropriate scope (`compile`, `test`, `provided`, `runtime`)
- Prefer managed versions via `<dependencyManagement>` in parent POMs

### Properties

Version properties follow the pattern `<artifactId.version>` or `<groupId.version>`.

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
