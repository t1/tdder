---
name: Nested Fixture Pattern
description: >
  This skill should be used when working on Java projects with JUnit tests that have layered
  preconditions, expensive shared setup (servers, databases, provisioned users), or complex
  scenario trees. Trigger phrases include "nested fixture", "fixture pattern", "scenario tree",
  "layered test setup", or when the user is writing integration tests with multiple levels of
  dependent setup/teardown. Complements the Java and TDD skills.
version: 0.1.0
---

# Nested Fixture Pattern

A pattern combining JUnit's `@Nested` classes, `@RegisterExtension`, and `ExtensionContext.Store`
to build declarative scenario trees where each nesting level adds a scope with fixture-managed data.
Tests focus on what's specifically relevant to them; expensive setup/teardown happens once per scope;
any subtree runs in isolation.

For background, rationale, and tradeoffs, see the [blog post](https://codeberg.org/t1/nested-fixture-pattern/raw/branch/trunk/blog.md).

## When to Use

- **Multiple, layered preconditions**: 2+ levels of setup that depend on each other, making setup code complex
- **Expensive shared setup**: servers, databases, provisioned users that shouldn't repeat per test
- **Well-understood domain**: the scenarios are stable enough that `Given...` class names can meaningfully describe each level
- **Subtree isolation needed**: you want to run any subset of the scenario tree independently in the IDE

## When Not to Use

- Simple tests with flat preconditions: just use `@BeforeAll` or `@BeforeEach`
- Each test method needs different setup: use parameterized tests
- Fast, isolated unit tests: overhead of fixtures and nesting isn't worth it
- Precondition hierarchies still in flux: refactoring fixtures is more expensive than flat setup

## Suggesting the Pattern

When you detect layered test setup (2+ levels of dependent `@BeforeAll`/`@BeforeEach`, or test classes
with complex shared state), use `AskUserQuestion`:

- **Question:** "This test has layered preconditions. Want to apply the nested fixture pattern?"
- **Options:**
  - "Yes, refactor to nested fixtures" — briefly describe what the fixture tree would look like
  - "No, keep flat setup" — acknowledge the trade-off (simpler structure, more setup duplication)

## The Pattern

Each `@Nested` class is a `Given` clause. Each `@RegisterExtension static` field is a fixture
that sets up when entering that class and tears down when leaving.

```java
class DocumentSharingScenarioTest {
    @RegisterExtension static ServerFixture server = new ServerFixture();

    @Nested class GivenUserAlice {
        @RegisterExtension static UserFixture alice = server.createUser("alice");

        @Test void seesEmptyDocumentList() {
            then(alice.listDocuments()).isEmpty();
        }

        @Nested class GivenDocument {
            @RegisterExtension static DocumentFixture doc =
                    alice.createDocument("notes.txt", "hello world");

            @Test void isVisibleToAlice() {
                then(alice.getDocument(doc.id()))
                        .hasName("notes.txt")
                        .hasContent("hello world");
            }

            @Nested class GivenSharedWithBob {
                @RegisterExtension static UserFixture bob = server.createUser("bob");
                @RegisterExtension static ShareFixture share =
                        doc.shareTo(bob, Permission.READ);

                @Test void bobCanRead() {
                    then(bob.getDocument(doc.id()))
                            .hasContent("hello world");
                }

                @Test void bobCannotWrite() {
                    assertThatThrownBy(() ->
                            bob.updateDocument(doc.id(), "modified"))
                            .isInstanceOf(ForbiddenException.class);
                }
            }
        }
    }
}
```

## Writing Fixtures

Each fixture implements `BeforeAllCallback` and guards setup with `computeIfAbsent`:

```java
class UserFixture implements BeforeAllCallback {
    private final ApiClient apiClient;
    private final String name;
    private String id;

    UserFixture(ApiClient apiClient, String name) {
        this.apiClient = apiClient;
        this.name = name;
    }

    @Override public void beforeAll(ExtensionContext context) {
        context.getStore(GLOBAL).computeIfAbsent(this, k -> {
            id = apiClient.createUser(name);
            return (AutoCloseable) () -> apiClient.deleteUser(id);
        });
    }

    String userId() {return id;}
}
```

### Teardown

The `computeIfAbsent` lambda returns an `AutoCloseable` that fires when the declaring
context ends. The fixture holds state; the store holds the cleanup handle.

> **JUnit 5 vs 6**: JUnit 5 uses `getOrComputeIfAbsent` and `CloseableResource`.
> JUnit 6 uses `computeIfAbsent` and `AutoCloseable`.

## Optional: Fixtures as Factories

Parent fixtures can create child fixtures via factory methods. The parent wires context
(API clients, auth tokens, resource IDs) so the child declaration stays clean:

```java
static ServerFixture server = new ServerFixture();
static UserFixture alice = server.createUser("alice");
static DocumentFixture doc = alice.createDocument("notes.txt", "hello world");
```

## Critical Rules

1. **Keep factories pure**: factory methods must only *store* parameters, never read fixture
   state. Field initializers run at class-load time, before `beforeAll`. Actual work happens
   inside `computeIfAbsent`.
2. **Declaration order matters**: JUnit processes `@RegisterExtension` fields in source order.
   A fixture that references another must be declared after it.
3. **Always use `GLOBAL` namespace and `this` as the store key**: `this` is identity-based,
   so each fixture instance is independent. Domain values (e.g. a user name) would alias
   independent fixtures with the same value; types (e.g. `UserFixture.class`) would alias
   all fixtures of that type. `GLOBAL` is sufficient because `this` is already unique.
   Never override `equals`/`hashCode` on fixtures — the store relies on identity.
