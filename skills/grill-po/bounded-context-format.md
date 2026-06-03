# Bounded Context File Format

## Single context

One `bounded-context.md` at the repo root.

## Multiple contexts (mono-repo)

Each context has its own `{name}-bounded-context.md`, e.g. `ordering-bounded-context.md`, living either at the
repo root or in the context's subdirectory. The context map is part of both `README.md` and `AGENTS.md` — add or
update a **"Bounded Contexts"** section in each file.

Create files lazily — only when you have something to write.

## Structure

```md
# {Context Name} Bounded Context

{One or two sentence description of what this context is and why it exists.}

## Language

**Order**:
{A one or two sentence description of the term}
_Avoid_: Purchase, transaction

**Invoice**:
A request for payment sent to a customer after delivery.
_Avoid_: Bill, payment request

**Customer**:
A person or organization that places orders.
_Avoid_: Client, buyer, account
```

## Rules

- **Be opinionated.** When multiple words exist for the same concept, pick the best one and list the others as
  aliases to avoid.
- **Flag conflicts explicitly.** If a term is used ambiguously, call it out under "Flagged ambiguities" with a
  clear resolution.
- **Keep definitions tight.** One or two sentences max. Define what it IS, not what it does.
- **Show relationships.** Use bold term names and express cardinality where obvious.
- **Only include terms specific to this context.** General programming concepts (timeouts, error types, utility
  patterns) don't belong even if the project uses them extensively. Before adding a term, ask: is this a concept
  unique to this context, or a general programming concept? Only the former belongs.
- **Group terms under subheadings** when natural clusters emerge. If all terms belong to a single cohesive area,
  a flat list is fine.
- **Write an example dialogue.** A conversation between a dev and a domain expert that demonstrates how the terms
  interact naturally and clarifies boundaries between related concepts.

## Context map section (multi-context repos only)

Add or update a "Bounded Contexts" section in both `README.md` and `AGENTS.md`:

```md
## Bounded Contexts

- [Ordering](./ordering-bounded-context.md) — receives and tracks customer orders
- [Billing](./billing-bounded-context.md) — generates invoices and processes payments
- [Fulfillment](./fulfillment-bounded-context.md) — manages warehouse picking and shipping

### Relationships

- **Ordering → Fulfillment**: Ordering emits `OrderPlaced` events; Fulfillment consumes them to start picking
- **Fulfillment → Billing**: Fulfillment emits `ShipmentDispatched` events; Billing consumes them to generate
  invoices
- **Ordering ↔ Billing**: Shared types for `CustomerId` and `Money`
```

When multiple contexts exist, infer which one the current topic relates to. If unclear, ask.
