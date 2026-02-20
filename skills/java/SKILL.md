---
name: Java Conventions
description: >
  This skill should be used when working on Java projects and the user asks to "write Java code",
  "add a Java class", "fix Java code", or when TDD or clean code skills are active in a project
  containing .java files. Provides Java-specific coding conventions that complement the
  language-agnostic TDD and clean code skills.
version: 0.1.0
---

# Java Conventions

Java-specific coding conventions complementing the TDD and Clean Code skills.

## Code Style

### Local Type Inference

Use `var` for local variable type inference where the type is clear from context.

```java
var users = userRepository.findAll();
var count = items.size();
```

### Static Imports

Prefer static imports when they do not reduce readability.
Exception: do not statically import `List.of(...)`, `Map.of(...)`, etc., as the context is lost.

```java
import static org.assertj.core.api.BDDAssertions.then;
import static org.mockito.BDDMockito.given;
```

### Javadoc

Use **Markdown** for Javadoc to improve in-IDE readability.

### Comments

Add comments only if they add real value. Prefer self-explanatory code.
Comments should explain "why", not "what".

### Exception Handling

Hide checked exceptions within a method by wrapping them in `RuntimeException` and add a helpful message:

```java
try{
        return objectMapper.writeValueAsString(value);
}catch(
JsonProcessingException e){
        throw new

RuntimeException("could not write value as string",e);
}
```

### Log Output

`System.out` output is only acceptable for "normal" output in CLI tools.
`System.err` output is only acceptable for warnings and diagnostics (logs) in CLI tools.
In all other cases, use some logging API (preferably slf4j) and a library (preferably logback).

### Dependency Injection

Prefer constructor injection over setters.

### Visibility

Internals are not `public` but have limited visibility.
Only well-defined APIs are `public`.

## Testing Conventions

### BDD Naming

Use BDD-style method names:

```java
@Test void shouldParseSemanticVersion() { ...}

@Test void shouldReturnEmptyForInvalidInput() { ...}
```

### BDD Assertions (AssertJ)

Use `then(...)` instead of `assertThat(...)`:

```java
then(result).

isEqualTo(expected);

then(list).

hasSize(3).

containsExactly("a","b","c");
```

### BDD Mockito

Use `given(...).willReturn(...)` instead of `when(...).thenReturn(...)`.
Place Mockito `given()` calls in the "given" block:

```java
given(repository.findById(id)).

willReturn(Optional.of(entity));

var result = service.process(id);

then(result).

isNotNull();
```

If the `then` of AssertJ is imported, too, fall back to `verify`.

### Test Block Formatting

- Always use an **empty line** to separate given, when, and then blocks (no comments)
- Within these blocks, do **not** add empty lines between statements

```java
@Test void shouldCalculateTotal() {
    given(taxService.rate()).willReturn(0.1);

    var items = List.of(new Item(10), new Item(20));
    var total = calculator.calculate(items);

    then(total).isEqualTo(33.0);
}
```

### Pending Tests

Use `@Disabled` for pending tests in the TDD test list:

```java
@Disabled("TODO handle the edge case")
@Test void shouldHandleEdgeCase() { ...}
```

### Test Structure

Use `@Nested` classes to group tests by scenario or method-under-test.
Name nested classes descriptively without a `Test` suffix, e.g. `GivenUserIsLoggedIn`.

Use `@BeforeEach` (and maybe a corresponding `@AfterEach`) within nested classes
when setup is truly shared across all tests in that group.
If the setup is expensive, use `@BeforeAll` and a static field within the nested class
(and `@AfterAll` to clean up).
Keep setup close to tests — only extract to `@BeforeEach` when multiple tests repeat the same given block.

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

## IDE Integration

Always check with the IDE for:

- Warnings (not just errors)
- All qualified names replaced by imports (if possible)
- Unused imports removed

## Documentation

Use `package-info.java` files for package-level documentation and architecture.
Read them whenever you read files within a package.
They should help agents to work with the files in a package.
