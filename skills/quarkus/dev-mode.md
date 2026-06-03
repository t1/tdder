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
Add `src/dev/java` (etc.) as a main source only when the `dev` Maven profile is active:

```xml

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
                            <goals>
                                <goal>add-source</goal>
                            </goals>
                            <configuration>
                                <sources>
                                    <source>src/dev/java</source>
                                </sources>
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

### Pattern B for Kotlin

`build-helper-maven-plugin` registers directories with Maven's source model, but
`kotlin-maven-plugin` does **not** read Maven's source model — it requires explicit
`sourceDirs` configuration. Use the `compile` execution override instead:

```xml

<profiles>
    <profile>
        <id>dev</id>
        <build>
            <defaultGoal>quarkus:dev</defaultGoal>
            <plugins>
                <plugin>
                    <groupId>org.jetbrains.kotlin</groupId>
                    <artifactId>kotlin-maven-plugin</artifactId>
                    <executions>
                        <execution>
                            <id>compile</id>
                            <configuration>
                                <sourceDirs>
                                    <sourceDir>${project.basedir}/src/dev/kotlin</sourceDir>
                                </sourceDirs>
                            </configuration>
                        </execution>
                    </executions>
                </plugin>
            </plugins>
        </build>
    </profile>
</profiles>
```

No `build-helper-maven-plugin` is needed for Kotlin Pattern B.

> **Do not list `src/main/kotlin` in `<sourceDirs>`.**
> Maven's `<sourceDirectory>` already registers it; repeating it causes
> `[WARNING] Duplicate source root` warnings.

### When to add `src/dev` to the test classpath

If you have shared fixtures or an in-memory fake, that both dev mode and tests use,
you can wire `src/dev` into the test classpath, too. Do **not** do that unconditionally,
as the class files show up in the test classpath, i.e. they become CDI-discoverable
in the test build, so their dependencies must be satisfiable in the test profile,
which may not be what you want.

If you actually need both, you can use Pattern A in addition, i.e. add **`@IfBuildProfile("dev")`
on classes that should only be available in the dev-mode, but not in the tests.

### Stale `.class` files after dev mode

When `-Pdev` compiles `src/dev` into `target/classes` (and maybe `target/test-classes`),
those `.class` files remain on disk after the dev service stops. Subsequent builds pick them up,
so it may be necessary to remove them, e.g. by doing a `mvn clean` (after stopping the dev-mode).
This is not recommended as a routine step, but it can help in cases.

## Choosing Between the Patterns

|                       | Pattern A (`@IfBuildProfile`) | Pattern B (`src/dev`)                       |
|-----------------------|-------------------------------|---------------------------------------------|
| Class in prod jar     | yes (inert)                   | no                                          |
| Dev mode started with | plain `mvn quarkus:dev`       | `mvn -Pdev`                                 |
| Maven config required | none                          | profile + `kotlin-maven-plugin` sourceDirs  |
| CDI guard annotation  | `@IfBuildProfile("dev")`      | none needed (add as safety net if CDI deps) |
| Stale-file risk       | none (guard is in the class)  | yes — mitigate with `@IfBuildProfile`       |

Prefer **Pattern A** when the dev class is simple and has no exotic dependencies, or
when dev mode cannot be started with an explicit Maven `dev` profile.
Prefer **Pattern B** when the dev class must be physically absent from the prod jar
(e.g. for compliance or size reasons), or needs dependencies that should not be in prod.
