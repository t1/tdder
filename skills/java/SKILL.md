---
name: java
description: Always load this skill when writing or modifying Java or Kotlin source code, regardless of how the user phrases the request.
version: 0.3.0
---

# Java & Kotlin Conventions

JVM language coding conventions complementing the TDD and Clean Code skills.
We use modern language features to reduce boiler plate and get more to the point.

## Java Version

When you need to know the latest Java version (e.g. for new projects, upgrades, or Dockerfiles),
query the Adoptium API:

```
https://api.adoptium.net/v3/info/available_releases
```

Use `most_recent_feature_release` (latest GA) by default.
Use `most_recent_lts` only when explicitly asked for LTS.

## Code Style

### Logic Expressions

* Try to prevent negating expressions, e.g., instead of `a != b ? doX() : doY()`
  use `a == b ? doY() : doX()`.

### Line Breaks

* Annotations can often go in the same line as the field or method they apply to.
  * Java: `@Override void foo() {` or `@Test void should() {`
  * Kotlin: `override fun foo() {` or `@Test fun should() {`

### Local Type Inference

**Java:** Use `var` for local variable type inference where the type is clear from context.

```java
var users = userRepository.findAll();
var count = items.size();
```

**Kotlin:** Type inference is the default. Prefer `val` (immutable) over `var` (mutable);
only use `var` when the variable must be reassigned.

```kotlin
val users = userRepository.findAll()
var count = items.size  // only if count is later mutated
```

### Static Imports (Java) / Imports (Kotlin)

**Java:** Prefer static imports when they do not reduce readability.
This includes constants like `MediaType.APPLICATION_JSON`.
The context is most often sufficient to understand what it is, e.g., `@Produces(APPLICATION_JSON)`.
Exception: do not statically import `List.of(...)`, `Map.of(...)`, or the like,
as a method name like `of` doesn't say, what it does.
The number of usages of the import is **not** relevant!

```java
import static jakarta.ws.rs.core.MediaType.APPLICATION_JSON;
import static org.assertj.core.api.BDDAssertions.then;
import static org.mockito.BDDMockito.given;
```

**Kotlin:** There are no static imports. Import top-level functions and object/companion members directly.
The same readability rule applies — import short, context-sufficient names; avoid importing bare `of`.

```kotlin
import jakarta.ws.rs.core.MediaType.APPLICATION_JSON
import org.assertj.core.api.BDDAssertions.then
import org.mockito.kotlin.given
```

### Javadoc / KDoc

**IMPORTANT** Use **Markdown** for doc comments to improve in-IDE readability.
Java uses Javadoc (`/** */`); Kotlin uses KDoc (same `/** */` syntax, same Markdown support).

### Comments

Add comments only if they add real value. Prefer self-explanatory code.
Comments should explain "why", not "what".

### Exception Handling

**Java:** Hide checked exceptions within a method by wrapping them in `RuntimeException` and add a helpful message:

```java
try{
    return objectMapper.writeValueAsString(value);
} catch(JsonProcessingException e) {
    throw new RuntimeException("could not write value as string",e);
}
```

**Kotlin:** Has no checked exceptions, so no wrapping is needed. When calling Java APIs that declare
checked exceptions, Kotlin treats them as unchecked — handle them only if recovery makes sense.

### Log Output

`System.out` output is only acceptable for "normal" output in CLI tools.
`System.err` output is only acceptable for warnings and diagnostics (logs) in CLI tools.
In all other cases, use some logging API (preferably slf4j) and if necessary a library (preferably logback).

### Constructors and Dependency Injection

When available, use the capabilities of a Dependency Injection framework like CDI.
Even though constructor injection is not commonly used in CDI,
it makes, e.g., unit-testing (when DI is *not* available) easier than field injection does.
Injecting with setters is very seldom a sensible option to choose.

If the value of a field doesn't depend on constructor parameters, then use a **Field initializer**:
* Java: `private final HttpClient httpClient = HttpClient.newHttpClient();`
* Kotlin: `val httpClient = HttpClient.newHttpClient()`

### Visibility

Only well-defined APIs are `public`. Internals are not, but have limited visibility,
i.e. `private` if possible. If wider than `private` is needed:
* Java: use package-private (no modifier)
* Kotlin: use `internal` (module-visible)

`protected` is only rarely necessary in either language.

## Testing Conventions

### BDD Naming

Use BDD-style method names.

Java:
```java
@Test void shouldParseSemanticVersion() { ... }

@Test void shouldReturnEmptyForInvalidInput() { ... }
```

Kotlin:
```kotlin
@Test fun shouldParseSemanticVersion() { ... }

@Test fun shouldReturnEmptyForInvalidInput() { ... }
```

### BDD Assertions

For verifications, use `assertj-core`.

Use `then(...)` instead of `assertThat(...)`:

```java
then(result).isEqualTo(expected);
then(list).hasSize(3).containsExactly("a","b","c");
```

### BDD Mockito

Use `given(...).willReturn(...)` instead of `when(...).thenReturn(...)`.
Place Mockito `given()` calls in the "given" block:

```java
given(repository.findById(id)).willReturn(Optional.of(entity));

var result = service.process(id);

then(result).isNotNull();
```

If the `then` of AssertJ is imported, too, fall back to `verify`.

### Test Block Formatting

- Always use an **empty line** to separate given, when, and then blocks (no comments)
- Within these blocks, do **not** add empty lines between statements

Java:
```java
@Test void shouldCalculateTotal() {
    given(taxService.rate()).willReturn(0.1);

    var items = List.of(new Item(10), new Item(20));
    var total = calculator.calculate(items);

    then(total).isEqualTo(33.0);
}
```

Kotlin:
```kotlin
@Test fun shouldCalculateTotal() {
    given(taxService.rate()).willReturn(0.1)

    val items = listOf(Item(10), Item(20))
    val total = calculator.calculate(items)

    then(total).isEqualTo(33.0)
}
```

### Pending Tests

Use `@Disabled` for pending tests in the TDD test list.

Java:
```java
@Disabled("TODO handle the edge case")
@Test void shouldHandleEdgeCase() { ... }
```

Kotlin:
```kotlin
@Disabled("TODO handle the edge case")
@Test fun shouldHandleEdgeCase() { ... }
```

### Test Structure

Use `@Nested` classes to group tests by scenario or method-under-test.
Name nested classes descriptively without a `Test` suffix, e.g. `GivenUserIsLoggedIn`.

Use `@BeforeEach` (and maybe a corresponding `@AfterEach`) within nested classes
when setup is truly shared across all tests in that group.
If the setup is expensive, use `@BeforeAll` and a static field within the nested class
(and `@AfterAll` to clean up).
Keep setup close to tests — only extract to `@BeforeEach` when multiple tests repeat the same given block.

In Kotlin, `@Nested` test classes must be declared as `inner class` (JUnit 5 requires non-static nested classes, and Kotlin nested classes are static by default).

```java
class OrderServiceTest {
    OrderService service;
    OrderRepository repository = mock();

    @BeforeEach void setUp() {
        service = new OrderService(repository);
    }

    @Nested class GivenOrderExists {
        Order order = new Order(42, "pending");

        @BeforeEach void setUp() {
            given(repository.findById(42)).willReturn(Optional.of(order));
        }

        @Test void shouldReturnOrder() {
            var result = service.getOrder(42);

            then(result).isEqualTo(order);
        }

        @Test void shouldCancelOrder() {
            service.cancel(42);

            then(order.getStatus()).isEqualTo("cancelled");
        }
    }

    @Nested class GivenOrderDoesNotExist {
        @BeforeEach void setUp() {
            given(repository.findById(42)).willReturn(Optional.empty());
        }

        @Test void shouldThrow() {
            thenThrownBy(() -> service.getOrder(42))
                    .isInstanceOf(OrderNotFoundException.class);
        }
    }
}
```

### Fakes vs Mocks

Neither fakes nor mocks are universally better — choose per dependency.

**Fakes** are handwritten or simplified implementations (e.g., an in-memory repository backed by a `HashMap`
or an H2 database).

|                            | Fakes                                  | Mocks                                       |
|----------------------------|----------------------------------------|---------------------------------------------|
| Coupling to implementation | Low — tests verify behavior, not calls | Higher — tests verify specific interactions |
| Readability                | High — tests read like production code | Moderate — `given`/`verify` adds ceremony   |
| Maintenance cost           | maintain another implementation        | repetition in every test                    |
| Refactoring resilience     | High — internals can change freely     | Lower — renaming a method breaks stubs      |
| Speed of writing           | Slower initially                       | Faster for one-off tests                    |

**Use fakes** when the dependency is stable and used across many tests (repositories, clocks, event buses).
**Use mocks** when verifying interactions matters, the dependency is volatile, or a fake would be complex to maintain.

If in doubt, start with a Fake.

## System Tests

System Tests (STs) go in the `test.system` package under the test root.
Sub-structure this package as the project grows.

Name ST classes with the suffix `ST` (e.g., `BookResourceST.java` / `BookResourceST.kt`). This
naming is not recognized by Surefire's default includes, so STs are
automatically excluded from normal test runs.

## IDE Integration

After editing Java or Kotlin files, always check with the IDE for:

- Warnings, not just errors (with IntelliJ you'll have to use `get_file_problems` with `errorsOnly: false`)
- All qualified names replaced by imports (if possible)
- Unused imports removed

## Documentation

**Java:** Use `package-info.java` files for package-level documentation and architecture.

**Kotlin:** Use a `package.md` file (or a dedicated `.kt` file with only a `@file:` doc comment and the package declaration) for the same purpose.

Read these files whenever you read files within a package.
They should help agents to work with the files in a package.
