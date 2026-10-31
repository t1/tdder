---
name: lombok
description: >
  Always load this skill when a Maven/Gradle project uses Lombok (lombok on the classpath or
  in the pom), when lombok annotations appear in source code, or when compilation fails with
  "cannot find symbol" errors for lombok-generated methods (builder(), getters, setters,
  constructors, etc.). Covers the JDK 21+ annotation-processor gotcha that silently disables
  Lombok.
version: 0.1.0
---

# Lombok

Lombok conventions and gotchas for Java projects. Language- and build-tool-specific conventions
are covered by the `java` and `maven` skills.

## Trigger: Lombok Not Running (JDK 21+)

Since JDK 21, javac no longer discovers annotation processors from the plain classpath — they
must be declared explicitly. **Symptoms:**

- Compilation fails with `cannot find symbol` for methods that Lombok should generate:
  `builder()`, `build()`, getters/setters (`getX()`/`setX()`), constructors (`@NoArgsConstructor`,
  `@AllArgsConstructor`, `@RequiredArgsConstructor`), `toString()`, `equals()`, `hashCode()`,
  `withX()` (`@With`), etc.
- The error location is a class annotated with `@Data`, `@Builder`, `@Value`, `@Getter`, ...
- Tests fail to compile calling `SomeLombokClass.builder()...` while the class itself compiled fine.

**Fix for Maven** — declare the processor explicitly in the compiler plugin (root pom, so all
modules inherit it):

```xml
<plugin>
    <groupId>org.apache.maven.plugins</groupId>
    <artifactId>maven-compiler-plugin</artifactId>
    <configuration>
        <annotationProcessorPaths>
            <path>
                <groupId>org.projectlombok</groupId>
                <artifactId>lombok</artifactId>
                <version>1.18.48</version>
            </path>
        </annotationProcessorPaths>
    </configuration>
</plugin>
```

Check the latest version with the version-lookup tool before pinning; never guess versions.
The lombok dependency itself stays `provided` scope — the `annotationProcessorPaths` entry is
what makes javac actually run it.

**Fix for Gradle:**

```groovy
dependencies {
    compileOnly 'org.projectlombok:lombok:1.18.48'
    annotationProcessor 'org.projectlombok:lombok:1.18.48'
}
```

## Stale Build Output After Fixing the Processor

Maven's incremental compilation can keep stale `target/classes` files compiled *without* Lombok
(missing `builder()` etc.), so the build keeps failing even after the pom is fixed. If the fix
"doesn't work", delete the affected modules' `target/` directories once and rebuild. Do not
assume the pom change is wrong — stale classes are the classic follow-up gotcha.

## IDE Support

- **IntelliJ:** enable *Settings → Build → Compiler → Annotation Processors → Enable annotation
  processing*, and install the Lombok plugin. Without it the IDE shows the same "cannot find
  symbol" errors even when Maven works.
- **Eclipse:** install the Lombok agent (lombok.jar) into the IDE.
- If the IDE and Maven disagree about lombok-generated symbols, suspect the IDE annotation
  processing setting first.

## Conventions

- Prefer `@Data` (or `@Value` for immutables) over hand-written boilerplate; add `@Builder` when
  construction needs many optional fields.
- Keep the lombok dependency in `provided` scope — it must not end up in the packaged artifact.
- When adding other annotation processors (MapStruct, etc.), list them all in
  `annotationProcessorPaths`; the entry replaces classpath discovery, it does not merge with it.
  MapStruct users also need `lombok-mapstruct-binding`.
