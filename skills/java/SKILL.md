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

Hide checked exceptions within a method by wrapping them in `RuntimeException`:

```java
try {
    return objectMapper.writeValueAsString(value);
} catch (JsonProcessingException e) {
    throw new RuntimeException(e);
}
```

### Console Output

`System.err` output is acceptable for warnings and diagnostics in CLI tools.

### Dependency Injection

Prefer constructor injection over setters.

### Visibility

Internals are not `public` but have limited visibility.
Only well-defined APIs are `public`.

## Testing Conventions

### BDD Naming

Use BDD-style method names:

```java
@Test void shouldParseSemanticVersion() { ... }
@Test void shouldReturnEmptyForInvalidInput() { ... }
```

### BDD Assertions (AssertJ)

Use `then(...)` instead of `assertThat(...)`:

```java
then(result).isEqualTo(expected);
then(list).hasSize(3).containsExactly("a", "b", "c");
```

### BDD Mockito

Use `given(...).willReturn(...)` instead of `when(...).thenReturn(...)`.
Place Mockito `given()` calls in the "given" block:

```java
// given
given(repository.findById(id)).willReturn(Optional.of(entity));

// when
var result = service.process(id);

// then
then(result).isNotNull();
```

### Test Block Formatting

- Always use an **empty line** to separate given, when, and then blocks
- Within the given block itself, do **not** add empty lines between setup statements

```java
@Test void shouldCalculateTotal() {
    // given
    var items = List.of(new Item(10), new Item(20));
    given(taxService.rate()).willReturn(0.1);

    // when
    var total = calculator.calculate(items);

    // then
    then(total).isEqualTo(33.0);
}
```

### Pending Tests

Use `@Disabled` for pending tests in the TDD test list:

```java
@Disabled @Test void shouldHandleEdgeCase() {}
```

## IDE Integration

Always check with the IDE for:
- Warnings (not just errors)
- All qualified names replaced by imports (if possible)
- Unused imports removed

## Documentation

Use `package-info.java` files for package-level documentation and architecture.
