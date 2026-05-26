# Quarkus Dev-Only Code

Patterns for code that should only run in dev mode (seeders, fake services, dev helpers)
and the trade-offs between them.

## Pattern A: `@IfBuildProfile("dev")` in `src/main`

Place the class in `src/main` and annotate with `@IfBuildProfile("dev")`, e.g. for Kotlin:

```kotlin
@IfBuildProfile("dev")
@ApplicationScoped
class DevDataSeeder {
    @Inject lateinit var repository: MyRepository

    @Transactional
    fun seed(@Observes event: StartupEvent) {
        if (repository.count() > 0) return   // idempotent across live-reloads
        // … persist seed data
    }
}
```

- ArC evaluates `@IfBuildProfile` at **build time**, not runtime. The bean is not wired
  in `prod` or `test` profiles: no proxy, no observer registration, no instance created.
- The `.class` file is present in the prod jar, but the bean is completely inert.
- No `LaunchMode` guard needed: `@IfBuildProfile` already suppresses the bean in the
  `test` profile, so it won't run during `@QuarkusTest` tests either.

## Pattern B: `src/dev/java` with `build-helper-maven-plugin`

The class is physically absent from the prod jar.
Add `src/dev/java` (etc.) as a main source only when the `dev` Maven profile is active,
and always as a test source so tests can share the same fixtures:

```xml
<build>
  <plugins>
    <plugin>
      <groupId>org.codehaus.mojo</groupId>
      <artifactId>build-helper-maven-plugin</artifactId>
      <executions>
        <execution>
          <!-- always: available on test classpath -->
          <phase>generate-sources</phase>
          <goals><goal>add-test-source</goal></goals>
          <configuration>
            <sources><source>src/dev/java</source></sources>
          </configuration>
        </execution>
      </executions>
    </plugin>
  </plugins>
</build>

<profiles>
  <profile>
    <id>dev</id>
    <build>
      <defaultGoal>quarkus:dev</defaultGoal>
      <plugins>
        <plugin>
          <groupId>org.codehaus.mojo</groupId>
          <artifactId>build-helper-maven-plugin</artifactId>
          <executions>
            <execution>
              <!-- only with -Pdev: compiled into target/classes, CDI-discoverable -->
              <phase>generate-sources</phase>
              <goals><goal>add-source</goal></goals>
              <configuration>
                <sources><source>src/dev/java</source></sources>
              </configuration>
            </execution>
          </executions>
        </plugin>
      </plugins>
    </build>
  </profile>
</profiles>
```

Classes in `src/dev/` need no `@IfBuildProfile`; they are absent from the prod jar
because `add-source` only runs under `-Pdev`. Dev mode is started with `mvn -Pdev`
(the `<defaultGoal>` makes specifying the goal unnecessary).

## Choosing Between the Patterns

|                       | Pattern A (`@IfBuildProfile`) | Pattern B (`src/dev/java`)            |
|-----------------------|-------------------------------|---------------------------------------|
| Class in prod jar     | yes (inert)                   | no                                    |
| Dev mode started with | plain `mvn quarkus:dev`       | `mvn -Pdev`                           |
| Maven config required | none                          | `build-helper-maven-plugin` + profile |
| CDI guard annotation  | `@IfBuildProfile("dev")`      | none needed                           |

Prefer **Pattern A** when it's only a few simple files, or the dev mode cannot be started with explicit Maven profiles.
Prefer **Pattern B** when for more complex cases.
