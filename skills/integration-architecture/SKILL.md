---
name: Integration Architecture
description: >
  This skill should be used when the user asks about "messaging patterns", "command vs event",
  "push vs pull", "message reliability", "at-least-once delivery", "idempotency",
  "transactional outbox", "saga pattern", "fire and forget", "retry strategy",
  "event-driven architecture", "message broker integration", "publish-subscribe",
  "request-reply", "backpressure", or when deciding how components communicate across
  process or network boundaries.
version: 0.1.0
---

# Integration Architecture

How components communicate across boundaries: message style, data flow direction, and failure handling.

This skill complements [Unfolding Architecture](../unfolding-architecture/SKILL.md), which covers the
decision of *whether* to use messaging at all (Communication dimension, Levels 0→1→2). Once you've
decided to communicate across boundaries, this skill guides *how*.

## Tradeoff: Command vs. Event Messages

Commands couple sender to receiver: the sender knows who to call and what to ask for.
Events invert the dependency: receivers must know the sender's domain to interpret what happened.
In more complex messaging patters, when several, interdependent messages are sent, the dependency is even stricter:
the sender of commands must know about the state of the receiver; with events it's the other way around.
Neither is strictly better.

**Prefer Commands when:**

- There is exactly one receiver
- Sender needs confirmation the action was performed
- Traceability and explicit flow matter
- The operation is imperative ("do this")

**Prefer Events when:**

- Multiple independent consumers react to the same thing
- Adding consumers should not require changing the sender
- Sender should not know about side effects
- The message describes something that happened ("this occurred")

**Key insight:** Events don't remove coupling, they move it. The receiver now needs to understand the
sender's context to react. This is worthwhile when senders change less often than the set of receivers.

**When introducing cross-boundary communication**, use `AskUserQuestion` with a code-based recommendation:

- **Question:** "Should this be a command or an event?"
- **Options:** Put the recommended option first with "(Recommended)". Use the option `description`
  to explain *why* based on the code — e.g., "The method name `orderCompleted` and the lack of a
  return value suggest a notification, not a directive" or "There is exactly one receiver
  (`PaymentService`) that needs to confirm the action."
- If the code signals are ambiguous, don't recommend — present both options neutrally.

### Request-Reply

A hybrid pattern: the sender sends a command and waits for a response, but communication is
asynchronous (via a broker with a reply queue, not a direct method call). Useful when you need the
decoupling benefits of messaging but the sender still requires a result.

**Prefer Request-Reply when:**

- The sender needs a result but should not be coupled to the receiver's deployment
- Temporal decoupling is needed (the reply may arrive later)
- Load leveling or routing through a broker is required

**Prefer direct commands when:**

- Latency matters and a synchronous call is acceptable
- The reply queue infrastructure would add complexity without clear benefit

## Tradeoff: Push vs. Pull

Who initiates data flow.

**Prefer Pull when:**

- Consumer only needs data on-demand
- Consumer controls timing and rate
- Request/response is sufficient
- Simpler infrastructure (HTTP, DB queries)

**Prefer Push when:**

- Consumers need data as soon as it's available
- Polling would create unnecessary load
- Multiple consumers need the same data
- Producer knows best when data is ready

**Key insight:** Push shifts backpressure responsibility to the consumer. Pull is simpler but can miss
real-time needs or waste resources on empty polls.

### Backpressure

When a producer pushes faster than a consumer can process, work piles up. Backpressure is how the
consumer signals the producer to slow down (or how the system absorbs the mismatch).

Common strategies:

- **Bounded queues**: reject or block when full — producer discovers the limit
- **Rate limiting**: consumer controls ingestion rate explicitly
- **Credit-based flow**: consumer grants the producer permission to send N messages per timeframe
- **Competing consumers**: scale out consumers to match producer throughput

Choose a strategy before going to production with push-based messaging. Unbounded queues are not a
strategy — they defer the problem until memory runs out.

## Dimension: Reliability

How communication handles failures. This dimension progresses under pressure, following
the unfolding principle: start at Level 0, unfold only when concrete problems force the change.

| Level | Style                    | Description                                                                                                                                                                |
|-------|--------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| 0     | Fire and forget          | Send and assume success. No retries. Simple, appropriate when loss is acceptable or communication is in-process.                                                           |
| 1     | Retry + idempotency      | Retry on failure; receivers are idempotent so duplicates are harmless. At-least-once delivery. Techniques: deduplication (message IDs), upserts, deterministic operations. |
| 2     | Transactional guarantees | Strongest guarantees, highest complexity. See techniques below.                                                                                                            |

**When choosing a reliability level**, use `AskUserQuestion` with a code-based recommendation:

- **Question:** "What reliability level does this communication need?"
- **Options:** Put the recommended option first with "(Recommended)". Use the option `description`
  to explain *why* based on the code — e.g., "This is an in-process call; failure means process
  crash anyway, so fire-and-forget is appropriate" or "This payment flow has business consequences
  on message loss; retry + idempotency is the minimum."
- If the code signals are ambiguous, don't recommend — present all options neutrally.

**Unfold to Level 1 when:**

- Communication crosses process or network boundaries,
  do transient failures (network blips, restarts) are to be expected
- Message loss has business consequences

**Do NOT unfold to Level 1 when:**

- Communication is in-process where failure = process crash anyway
- The operation is naturally idempotent and loss is acceptable for the business

**Unfold to Level 2 when:**

- Duplicates have business consequences that idempotency cannot absorb
- An operation must atomically update local state AND send a message (outbox pattern)
- Multiple services must coordinate a consistent outcome (saga)

**Do NOT unfold to Level 2 when:**

- Idempotency is cheap to implement (prefer Level 1)
- The operation is naturally idempotent (e.g., setting a value, not incrementing)
- Only one service owns the data being changed

### Level 2 Techniques

**Transactional outbox:** Instead of sending a message directly (which can fail independently of the
local transaction), write the message to an outbox table in the same database transaction as the
business data change. A separate process reads the outbox and publishes the messages. This guarantees
that the local state change and the message are atomic — either both happen or neither does.

**Saga:** A sequence of local transactions across multiple services, each publishing an event or
command that triggers the next step. If a step fails, compensating transactions undo the preceding
steps. Sagas trade atomicity for availability — the system is eventually consistent, and you must
design compensating actions for every step that can fail.

## Testing Distributed Failures

Integration code fails in ways that unit tests for business logic never exercise: brokers restart,
messages arrive out of order, schemas drift between producer and consumer, compensation logic
triggers under unexpected conditions. The scopes below are independent — pick the ones that
match the risks of a given integration rather than treating them as a progression.

Note that it may be possible to run the same tests at various scopes, with only the test drivers /
fixtures running in different configurations. This can reduce the cost for the maintaining tests,
while it may also add complexity.

Test doubles (fakes, mocks, stubs) are not tied to a single scope. A unit test may fake a broker
client; a system test may fake an external payment provider while using a real broker. Choose the
double that isolates the failure you want to test.

### Scope: Unit

Test message handling logic in isolation: serialization/deserialization, idempotency checks,
compensation logic, routing decisions. All infrastructure is faked or mocked.

**Good at catching:** Logic errors in message handlers, incorrect deduplication, broken
serialization for edge-case payloads, flawed compensation logic.

**Example:** A handler receives a duplicate message ID — does it skip processing? A compensation
function receives a partial state — does it undo the right steps?

### Scope: Integration

A single service running against technical real but local infrastructure (e.g., Testcontainers
for broker and database) or fakes or mocks. The service processes messages end-to-end
through its own stack, but no real remote service is involved.

**Good at catching:**

- *Technical failures:* connection handling after broker restart, acknowledgment semantics
  (does the message re-deliver on crash?), transaction boundaries between DB and broker,
  poison messages that block a queue.
- *Business failures:* handler rejects a message (validation failure) — does it dead-letter
  or retry? A transactional outbox entry is written but the relay crashes — does it recover?

### Scope: Contract

Producer and consumer agree on a message schema, verified independently of deployment. Each side
runs its own tests against the shared contract. Neither side needs the other to be running.

**Good at catching:** Schema drift, breaking changes in field names or types, missing required
fields, incompatible serialization formats. Especially valuable when different teams own
producer and consumer.

### Scope: System

Multiple services running together — some real, some faked. Exercises end-to-end flows across
service boundaries.

**Good at catching:**

- *Technical failures:* timeout cascades (service A waits for B which waits for C), message
  ordering assumptions that hold in integration tests but break under concurrent load,
  fault injection (kill a service mid-saga — does compensation trigger?).
- *Business failures:* saga compensation across services (does the full undo sequence work?),
  eventual consistency (does the read model converge?), cross-service validation
  (service A accepts a message that service B later rejects — what happens?).

### Choosing Scopes

Start with unit tests for any non-trivial message handling logic — they're fast and cheap. Add
integration scope when the service talks to a real broker or database, because those interactions
are where most production failures hide. Add contract scope when producer and consumer are owned
by different teams or deployed independently. Add system scope for critical flows where
cross-service failure behavior matters (sagas, compensation chains, consistency guarantees).

You don't need all four for every integration. A fire-and-forget event with a single consumer
may only need unit + integration. A saga across three services owned by two teams likely needs
all four.

## Anti-Patterns

### Event Soup

Making everything an event. When every action publishes an event and every component reacts to
events, the system becomes impossible to trace. Commands exist for a reason — use them when the
sender knows the receiver and needs confirmation.

### Distributed Monolith

Sending commands to every service for every operation, replicating the coupling of a monolith
across the network. You get the worst of both worlds: distributed complexity with monolithic
coupling. If every service change requires coordinated deployments, messaging has not helped.

### Reliability Theater

Using Level 2 reliability (outbox, sagas) everywhere "just in case." Transactional guarantees
are expensive in complexity and operational burden. Most communication tolerates at-least-once
delivery (Level 1) or even fire-and-forget (Level 0). Match the reliability level to the actual
business consequences of failure.

### Late Integration

Designing components in isolation and deferring integration to the end. Each team builds their
service with assumed message formats, assumed delivery semantics, and assumed ordering — then
discovers at integration time that the assumptions don't match. The fix is expensive because
contracts are baked into the internals.

Instead, integrate continuously from the start. Define message contracts early, even if the
implementation behind them is trivial. Run integration tests against real (or realistic) brokers
as soon as two components exist. Let integration pain surface while the design is still cheap to change.

This is also true for integrating with a (real) database, etc.

### Backpressure Denial

Using unbounded queues and assuming the consumer will keep up. This works until it doesn't, and
then you lose messages or crash. Design for the producer being faster than the consumer from day one.

## Integration with Other Skills

- **Unfolding Architecture**: The Communication dimension (Levels 0→1→2) decides *whether* to introduce
  messaging. This skill picks up from there and guides *how* to design the messages.
- **TDD**: Integration decisions surface during the refactor phase. Typical triggers: a test becomes
  brittle because it depends on message ordering, a test reveals that duplicates cause incorrect state,
  or a refactoring exposes that two components communicate but have no failure handling. Let the test
  tell you which reliability level or message style is needed — don't choose upfront.
- **APP**: Introducing a message broker, outbox tables, or saga orchestrators adds mass. Measure before
  and after. If the mass increase is not justified by a concrete problem being solved, reconsider.
