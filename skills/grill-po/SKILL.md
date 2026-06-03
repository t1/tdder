---
name: grill-po
description: >
  Requirements grilling session with a Product Owner (or anyone in that role). Challenges plans against
  the existing domain model, sharpens terminology, and updates documentation (bounded-context files,
  Gherkin features, DMDs) inline as decisions crystallise. Use when the user wants to discuss and
  capture requirements, stress-test a plan against the project's language, or refine feature scope.
version: 0.1.0
---

# Grill PO

Interview the user relentlessly about every aspect of their plan until you reach a shared understanding.
Walk down each branch of the design tree, resolving dependencies between decisions one-by-one. For each
question, provide your recommended answer.

Ask questions one at a time, waiting for feedback on each before continuing.

If a question can be answered by exploring the codebase, explore the codebase instead.

## Domain Awareness

During codebase exploration, also look for existing documentation.

### File Structure

**Single-context repo:**

```
/
├── bounded-context.md
├── docs/
│   └── features/
│       ├── place-order.feature
│       └── cancel-order.feature
└── src/
```

**Multi-context mono-repo:**

```
/
├── README.md                          ← contains "Bounded Contexts" section (context map)
├── AGENTS.md                          ← contains "Bounded Contexts" section (context map)
├── docs/
├── src/
│   ├── ordering/
│   │   ├── ordering-bounded-context.md
│   │   └── docs/features/             ← context-specific features
│   └── billing/
│       └── billing-bounded-context.md
```

Create files lazily — only when you have something to write.

**Detecting the structure:**

- If a `bounded-context.md` exists at root → single context
- If `*-bounded-context.md` files exist elsewhere → multi-context; read the "Bounded Contexts" section of
  `README.md` or `AGENTS.md` for the context map
- If neither exists → create `bounded-context.md` lazily when the first term is resolved

When multiple contexts exist, infer which one the current topic relates to. If unclear, ask.

## During the Session

### Challenge against the glossary

When the user uses a term that conflicts with the existing language in the bounded-context file, call it out
immediately. "Your glossary defines 'cancellation' as X, but you seem to mean Y — which is it?"

Also scan existing `.feature` files for terminology drift: if a scenario uses a term differently from the
bounded-context file, surface it. "Your feature file says 'purchase' but the glossary defines that concept
as 'order' — which should it be?"

### Sharpen fuzzy language

When the user uses vague or overloaded terms, propose a precise canonical term. "You're saying 'account' — do you
mean the Customer or the User? Those are different things."

### Discuss concrete scenarios

When domain relationships are being discussed, stress-test them with specific scenarios. Invent scenarios that
probe edge cases and force the user to be precise about the boundaries between concepts.

### Update the bounded-context file inline

When a term is resolved, update the bounded-context file right there. Don't batch these up — capture them as they
happen. Use the format in [references/bounded-context-format.md](references/bounded-context-format.md).

The bounded-context file must be totally devoid of implementation details. Do not treat it as a spec, a scratch
pad, or a repository for implementation decisions. It is a **glossary and nothing else**.

### Document features as Gherkin

When a feature is agreed on, write or update a `.feature` file in `docs/features/` (or the context-specific
equivalent). Use standard Gherkin (`Feature`, `Scenario`, `Given`/`When`/`Then`). Rules:

- One `.feature` file per feature area, named after it (e.g. `place-order.feature`)
- Scenarios use domain language from the bounded-context file — no technical terms
- Scenarios are business-readable: a domain expert should be able to read and validate them
- Do not add scenarios for implementation details (e.g. HTTP status codes, database columns)
- Update existing scenarios when behavior changes — don't accumulate stale scenarios

### Offer DMDs sparingly

Only offer to create a DMD when all three are true:

1. **Hard to reverse** — the cost of changing your mind later is meaningful
2. **Surprising without context** — a future reader will wonder "why did they model it that way?"
3. **The result of a real trade-off** — there were genuine alternatives and you picked one for specific reasons

If any of the three is missing, skip the DMD. Use the format in
[references/dmd-format.md](references/dmd-format.md).
