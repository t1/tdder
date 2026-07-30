---
name: unfolding-architecture
description: >
  This skill should be used when the user asks to "design the architecture", "should I add a service layer",
  "add an abstraction", "introduce an interface", "separate concerns", "add a repository",
  "use hexagonal architecture", "add domain events", "split into layers", "add ports and adapters",
  "decouple this", "add an anti-corruption layer", "review package structure",
  "apply a design pattern", "which design pattern fits", "introduce a factory/strategy/builder",
  or when considering architectural changes during a TDD refactor phase.
  It also contains guides when starting a new project.
version: 0.1.0
---

# Unfolding Architecture

Progressive architectural decisions: start simple, add complexity only when it reduces complexity.

Architecture is not a blueprint drawn before construction. It unfolds from working code under concrete
pressure. Each dimension of architecture starts at its simplest form (Level 0) and only moves to a
higher level when a specific, demonstrable problem forces the change.

**Central creed: code quality = maintaining long-term speed of development.** Every architectural
decision — unfolding a dimension, applying a design pattern, or removing one — is judged by whether
it keeps the code easy to understand and change tomorrow.

## Default Starting Point

**Level 0 in all dimensions.** No deviation without a concrete reason backed by a violated constraint,
or measurable complexity increase. "It might be useful later" is never a valid reason to unfold.

## Dimensions

### 1. Data vs Logic

| Level | Style                              | Description                                                                                                       |
|-------|------------------------------------|-------------------------------------------------------------------------------------------------------------------|
| 0     | OOP: data + logic together         | Data and the logic that operates on it live in the same class. Logic hides data. This is the natural OOP default. |
| 1     | DOP: separate data from algorithms | Stable data structures with varying algorithms applied externally. Data is transparent; logic is separate.        |

**Unfold to Level 1 when:**

- Multiple independent algorithms need to operate on the same data
- Data structures are stable but processing varies significantly
- Serialization/deserialization concerns conflict with behavior encapsulation

**Do NOT unfold when:**

- Data and logic change together (they belong together)
- There is only a hand full of algorithms per data structure that are closely related to the data
- The separation would scatter related behavior across files

### 2. Indirection

| Level | Style                        | Description                                                                                                                                                                                                                               |
|-------|------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| 0     | Direct dependencies          | Everything knows about everything it uses. No interfaces, no layers, no DTOs. Persistence lives next to domain.                                                                                                                           |
| 1     | Targeted abstraction         | Interface or anti-corruption layer at a specific pain point — persistence, external API, or unstable component.                                                                                                                           |
| 2     | Ports & adapters (hexagonal) | Full separation of domain from infrastructure via IoC: the domain defines ports (interfaces), adapters implement them, dependencies point inward. Persistence is just one adapter among many. A composition root wires adapters to ports. |

**Unfold to Level 1 when:**

- A component has multiple concrete implementations that must be swappable
- A dependency crosses a deployment boundary (e.g., external service)
- Testing requires replacing a real dependency with a test double, e.g. calling an external service
- An external system's model leaks into and distorts the domain model
- An external API returns data in a shape that does not match domain concepts
- Changes in one component frequently force changes in an unrelated component
- Persistence technology needs to change and the domain should not be affected

**Unfold to Level 2 when:**

- Multiple adapters exist for the same port (e.g., database + in-memory for tests,
  but there is no suitable abstraction layer available in the platform, e.g. an EntityManager)
- It becomes too complex to test the domain in isolation from real infrastructure
- The system has many distinct infrastructure concerns (persistence, messaging, external APIs, etc.)
  that would clutter the domain

**Do NOT unfold when:**

- Only one implementation exists, and it can be seen as an implementation or model detail of the domain
- The "interface" would mirror the class 1:1 (interface bloat)
- The coupling is between genuinely related concepts (cohesion, not coupling)
- DTOs or DB Entities would be identical copies of domain objects (except for some annotations, etc.)
- The "boundary" is between two internal components that change together
- The application has a single persistence mechanism and no external integrations

**Note:** Even hexagonal architecture can evolve step-by-step. You do not need to introduce all ports
and adapters at once. Start with a single targeted abstraction (Level 1) where the pressure is highest,
then add more ports as concrete needs arise. Full hexagonal (Level 2) is the result of multiple
incremental unfoldings, not a single architectural decision.

### 3. Communication

| Level | Style                      | Description                                                                                       |
|-------|----------------------------|---------------------------------------------------------------------------------------------------|
| 0     | Direct method calls        | Components call each other directly. Simple, traceable, debuggable.                               |
| 1     | Domain events (in-process) | Components publish events that other components react to, but within the same process.            |
| 2     | Async messaging (broker)   | Communication through a message broker. Full decoupling of sender and receiver in time and space. |

**Unfold to Level 1 when:**

- An action must trigger multiple independent side effects (e.g., send email AND update audit log)
  that change independently of the triggering action
- Circular dependencies emerge between components that cannot easily be resolved by other means

**Unfold to Level 2 when:**

- Components must be deployed and scaled independently
- Temporal decoupling is required (sender must not wait for receiver)
- The system spans multiple processes or services
- Exactly-one guarantees are necessary (mostly using Two-Phase-Commits)

**Do NOT unfold when:**

- There is only one consumer for each action
- Traceability and debuggability are more important than decoupling
- The indirection would obscure a simple, linear flow

### 4. Package Structure Guarantees

| Level | Style                    | Description                                                                                                |
|-------|--------------------------|------------------------------------------------------------------------------------------------------------|
| 0     | Manual                   | No enforced dependency rules between packages. Any class can use any other class (as long as it's public). |
| 1     | Package dependency tests | Packages exist with clear responsibilities. Dependency rules between packages are enforced by tests.       |
| 2     | Modulith                 | Separate modules within one deployable unit, each with explicit API boundaries and enforced encapsulation. |
| 3     | Microservices            | Independent services, separately built and deployed, communicating over network boundaries.                |

**Unfold to Level 1 when:**

- The codebase grows beyond a handful of packages and accidental cross-package dependencies start appearing
- Changes in one package unexpectedly break another
- Package responsibilities become blurred because nothing enforces boundaries
- Dependency cycles emerge between packages

**Unfold to Level 2 when:**

- Dependency tests alone are insufficient to maintain isolation (too many rules, hard to reason about)
- Teams need stronger encapsulation with explicit public APIs per module
- You want independent module testing with enforced visibility constraints

**Unfold to Level 3 when:**

- Modules need independent scaling, i.e. scaling the full modulith to handle only a minor subset of functionality would
  be too expensive;
  this is often cited, but hardly really the case
- Different teams develop and deploy independently the different microservices
- Modules have different security requirements, so the non-critical parts make the attack surface too big for the
  critical ones

**Do NOT unfold to Level 1 when:**

- The system is small enough that a developer can hold the full dependency graph in their head

**Do NOT unfold to Level 2 when:**

- All packages change together and are released together (splitting adds overhead without benefit)

**Do NOT unfold to Level 3 when:**

- The team is small and communication overhead of service boundaries outweighs the decoupling benefit

### 5. Error Handling

| Level | Style                         | Description                                                                            |
|-------|-------------------------------|----------------------------------------------------------------------------------------|
| 0     | Exceptions                    | Throw exceptions for errors. Catch at appropriate boundaries. Simple and conventional. |
| 1     | Result types                  | Return result objects that explicitly model success and failure for business outcomes. |
| 2     | Circuit breakers / resilience | Resilience patterns for dealing with unreliable external dependencies.                 |

**Unfold to Level 1 when:**

- Business logic has expected failure cases that are not exceptional (e.g., validation of user input)
- Callers must distinguish between multiple failure modes to make decisions
- Exception-based control flow obscures the business logic

**Unfold to Level 2 when:**

- External dependencies are unreliable and failures must be contained / backpressure applied
- Cascading failures are a real risk (not hypothetical)
- The system must degrade gracefully under partial failure, esp. on high load

**Do NOT unfold when:**

- Failures are truly exceptional and unexpected
- The language/framework has strong exception conventions that result types would fight
- There is no external dependency that warrants resilience patterns

## Design Patterns

The dimensions above describe *where* a system can grow; design patterns describe *how* to structure
the code at a specific spot. As complexity grows and code becomes harder to understand or evolve,
evaluate whether a known pattern would help. Many patterns are simply the concrete shape of a
dimension's level — e.g. Adapter is what Level 1 indirection often looks like, and domain events are
the Observer pattern applied across components.

Examples to consider, grouped by origin:

- **GoF classics**: Strategy, Factory Method, Builder, Observer, Composite, Adapter, Decorator,
  Template Method, State
- **Domain & persistence** (Fowler's PoEAA, DDD): Repository, Specification, Unit of Work, Data
  Mapper vs Active Record, Transaction Script vs Domain Model, Entity, Value Object, Aggregate,
  Domain Service
- **Functional & general**: Dependency Injection, Null Object, Pipeline, Railway-Oriented
  Programming, Retry/Backoff, Saga
- **Tech-stack specific**: every stack has its own idiomatic patterns — e.g. Java/CDI (Quarkus,
  Spring): producer methods, interceptors, CDI events; JPA: entity graphs, optimistic locking;
  TypeScript/React: custom hooks, render props, container/presentational. Prefer the stack's
  idiomatic pattern over a framework-agnostic one that fights the platform.
- **Testing patterns**: Test Data Builder, Object Mother, Test Doubles (fake, stub, spy, mock),
  Nested Fixtures (see the `nested-fixture-pattern` skill), Given-When-Then, Parameterized Tests,
  Approval/Golden Master tests, Contract Tests, Page Objects

Applying a pattern is an unfolding step like any other:

1. **Evaluate pros and cons for this concrete situation** — not in the abstract. A pattern that adds
   indirection without removing a concrete pain is speculative architecture.
2. **Document the reasoning briefly** when a pattern is picked: one or two sentences on why this
   pattern, why now, and which alternative was rejected (code comment, commit message, or ADR).
3. **Trial implementations are allowed**: implement the pattern, then judge whether code quality
   actually improved (readability, testability, APP mass). If it didn't, roll it back.
4. **Patterns are reversible**: if a pattern proves sub-optimal as the code evolves, remove it again
   or replace it with a pattern that is more appropriate in the new light. A pattern is a means to
   maintain development speed, not a commitment.

## Naming Conventions

- A companion class / repository / DAO to a domain entity should be the plural of the
  entity, e.g. `Products` for `Product`

## How to Use

Unfolding happens during the **TDD refactor phase**:

1. **Complete the Red-Green cycle** — get the test passing first
2. **During refactoring**, check if any dimension is under pressure
3. **Before unfolding**, use `AskUserQuestion` to confirm:
   - **Question:** "I see pressure on [dimension] to unfold from Level N to N+1. Should we?"
   - **Options:**
     - "Yes, unfold (Recommended)" — include a one-line reason derived from the code
       (e.g., "Two independent algorithms now operate on the same data structure")
     - "No, keep current level" — explain what trade-off the user is accepting
     - "Let's discuss" — elaborate on the pressure signals before deciding
4. **Unfold one dimension at a time** — never unfold two dimensions simultaneously
5. **Verify**: all tests still pass after unfolding
6. **Document the reason**: state in one sentence why this unfolding was necessary

The decision checklist at `decision-checklist.md` provides a quick rubric.

## Anti-Patterns

### Speculative Architecture

Adding layers, interfaces, or patterns "because we might need them." If no concrete test or
requirement demands it, do not add it.

### Uniform Depth

Making all dimensions the same level. A system might legitimately need Level 2 indirection
but Level 0 communication. Each dimension is independent.

### Architecture Envy

Copying the architecture of a different system or a reference application. Architecture must
emerge from the specific pressures of this system.

### Pattern Collecting

Applying design patterns because they are well-known or "standard", not because a concrete pressure
demands them. A pattern without a problem it solves is just indirection.

### Premature DOP

Separating data from logic before multiple algorithms actually exist. Data and logic that change
together should stay together.

### Layer Cake

Adding layers for the sake of "proper architecture": Controller → Service → Repository → DAO,
each doing nothing but delegating to the next. Every layer must justify its existence.

## Integration with Other Skills

- **TDD**: Unfolding happens during refactor phases. A failing test or a refactoring need is the
  trigger — never unfold speculatively before a test demands it.
- **Clean Code**: Unfolding often shifts the indirection balance (Dimension 2). Apply clean
  code principles to evaluate whether the shift improves or worsens the design.
- **APP**: After unfolding, compare mass before and after. If mass increased without a proportional
  gain in clarity or testability, reconsider the change.
