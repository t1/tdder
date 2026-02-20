---
name: Unfolding Architecture
description: >
  This skill should be used when the user asks to "design the architecture", "should I add a service layer",
  "add an abstraction", "introduce an interface", "separate concerns", "add a repository",
  "use hexagonal architecture", "add domain events", "split into layers", "add ports and adapters",
  "should I use CQRS", "decouple this", "add an anti-corruption layer",
  or when considering architectural changes during a TDD refactor phase.
  It also contains guides when starting a new project.
version: 0.1.0
---

# Unfolding Architecture

Progressive architectural decisions: start simple, add complexity only when it reduces complexity.

Architecture is not a blueprint drawn before construction. It unfolds from working code under concrete
pressure. Each dimension of architecture starts at its simplest form (Level 0) and only moves to a
higher level when a specific, demonstrable problem forces the change.

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
- There is only one algorithm per data structure
- The separation would scatter related behavior across files

### 2. Coupling & Cohesion

| Level | Style                          | Description                                                                                 |
|-------|--------------------------------|---------------------------------------------------------------------------------------------|
| 0     | High cohesion, accept coupling | Keep related things together. Accept that tightly related components know about each other. |
| 1     | Loose coupling via interfaces  | Introduce interfaces/abstractions to decouple components that change independently.         |

**Unfold to Level 1 when:**

- A component has multiple concrete implementations that must be swappable
- A dependency crosses a deployment boundary (e.g., external service)
- Testing requires replacing a real dependency with a test double
- Changes in one component frequently force changes in an unrelated component

**Do NOT unfold when:**

- Only one implementation exists and none others are foreseeable from current requirements
- The "interface" would mirror the class 1:1 (interface bloat)
- The coupling is between genuinely related concepts (cohesion, not coupling)

### 3. Layering & Boundaries

| Level | Style                             | Description                                                                                              |
|-------|-----------------------------------|----------------------------------------------------------------------------------------------------------|
| 0     | No layers, no DTOs                | Everything in one place. No translation objects. Direct access.                                          |
| 1     | Anti-corruption layer at boundary | A translation layer at a specific integration point to protect the domain from external model pollution. |
| 2     | Hexagonal (ports & adapters)      | Full separation of domain from infrastructure via ports (interfaces) and adapters (implementations).     |

**Unfold to Level 1 when:**

- An external system's model leaks into and distorts the domain model
- A specific integration point is unstable or likely to be replaced
- An external API returns data in a shape that does not match domain concepts

**Unfold to Level 2 when:**

- Multiple adapters exist for the same port (e.g., database + in-memory for tests)
- The domain must be testable in complete isolation from all infrastructure
- The system has 3+ distinct infrastructure concerns (persistence, messaging, external APIs)

**Do NOT unfold when:**

- The application has a single persistence mechanism and no external integrations
- DTOs would be identical copies of domain objects
- The "boundary" is between two internal components that change together

### 4. Communication

| Level | Style                      | Description                                                                                       |
|-------|----------------------------|---------------------------------------------------------------------------------------------------|
| 0     | Direct method calls        | Components call each other directly. Simple, traceable, debuggable.                               |
| 1     | Domain events (in-process) | Components publish events that other components react to, but within the same process.            |
| 2     | Async messaging (broker)   | Communication through a message broker. Full decoupling of sender and receiver in time and space. |

**Unfold to Level 1 when:**

- A action must trigger multiple independent side effects (e.g., send email AND update audit log)
- The side effects change independently of the triggering action
- Circular dependencies emerge between components

**Unfold to Level 2 when:**

- Components must be deployed and scaled independently
- Temporal decoupling is required (sender must not wait for receiver)
- The system spans multiple processes or services

**Do NOT unfold when:**

- There is only one consumer for each action
- Traceability and debuggability are more important than decoupling
- The indirection would obscure a simple, linear flow

### 5. Persistence

| Level | Style              | Description                                                                                     |
|-------|--------------------|-------------------------------------------------------------------------------------------------|
| 0     | Direct persistence | Persistence logic lives close to the domain (e.g., companion class, DAO). No abstraction layer. |
| 1     | Repository pattern | Domain-oriented collection interface hides persistence details.                                 |
| 2     | CQRS               | Separate models and paths for reads and writes.                                                 |

**Unfold to Level 1 when:**

- Persistence technology may change and the domain should not be affected
- Complex query logic needs to be testable without a database
- Multiple aggregates share persistence patterns worth unifying

**Unfold to Level 2 when:**

- Read and write models have fundamentally different shapes or performance requirements
- Read-heavy workloads require denormalized views
- Event sourcing is used for writes

**Do NOT unfold when:**

- The application uses a single, stable persistence technology
- CRUD operations map directly to domain operations
- The repository interface would have a single implementation forever

### 6. Error Handling

| Level | Style                         | Description                                                                            |
|-------|-------------------------------|----------------------------------------------------------------------------------------|
| 0     | Exceptions                    | Throw exceptions for errors. Catch at appropriate boundaries. Simple and conventional. |
| 1     | Result types                  | Return result objects that explicitly model success and failure for business outcomes. |
| 2     | Circuit breakers / resilience | Resilience patterns for dealing with unreliable external dependencies.                 |

**Unfold to Level 1 when:**

- Business logic has expected failure cases that are not exceptional (e.g., validation)
- Callers must distinguish between multiple failure modes to make decisions
- Exception-based control flow obscures the business logic

**Unfold to Level 2 when:**

- External dependencies are unreliable and failures must be contained
- Cascading failures are a real risk (not hypothetical)
- The system must degrade gracefully under partial failure

**Do NOT unfold when:**

- Failures are truly exceptional and unexpected
- The language/framework has strong exception conventions that result types would fight
- There is no external dependency that warrants resilience patterns

## How to Use

Unfolding happens during the **TDD refactor phase**:

1. **Complete the Red-Green cycle** — get the test passing first
2. **During refactoring**, check if any dimension is under pressure
3. **Unfold one dimension at a time** — never unfold two dimensions simultaneously
4. **Verify**: all tests still pass after unfolding
5. **Document the reason**: state in one sentence why this unfolding was necessary

The decision checklist at `references/decision-checklist.md` provides a quick rubric.

## Anti-Patterns

### Speculative Architecture

Adding layers, interfaces, or patterns "because we might need them." If no concrete test or
requirement demands it, do not add it.

### Uniform Depth

Making all dimensions the same level. A system might legitimately need Level 2 persistence
but Level 0 communication. Each dimension is independent.

### Architecture Envy

Copying the architecture of a different system or a reference application. Architecture must
emerge from the specific pressures of this system.

### Premature DOP

Separating data from logic before multiple algorithms actually exist. Data and logic that change
together should stay together.

### Layer Cake

Adding layers for the sake of "proper architecture": Controller → Service → Repository → DAO,
each doing nothing but delegating to the next. Every layer must justify its existence.

## Integration with Other Skills

- **TDD**: Unfolding happens during refactor phases. A failing test or a refactoring need is the
  trigger — never unfold speculatively before a test demands it.
- **Clean Code**: Unfolding often shifts the cohesion/coupling balance (Dimension 2). Apply clean
  code principles to evaluate whether the shift improves or worsens the design.
- **APP**: After unfolding, compare mass before and after. If mass increased without a proportional
  gain in clarity or testability, reconsider the change.
