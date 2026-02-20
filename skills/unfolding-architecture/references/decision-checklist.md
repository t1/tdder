# Unfolding Architecture Decision Checklist

Use this checklist before unfolding any architectural dimension.

## General Gate (All Dimensions)

All three must be "yes" before unfolding:

- [ ] Is there a **concrete problem right now** (not a hypothetical future problem)?
- [ ] Will the unfolded design be **simpler to understand** than the current design?
- [ ] Is there a **test or requirement** that motivates this change?

If any answer is "no", do not unfold.

## Per-Dimension Checks

### Data vs Logic (Dimension 1)

- [ ] Are there multiple independent algorithms operating on the same data?
- [ ] Are data structures stable but processing varies significantly?
- [ ] Do serialization/deserialization concerns conflict with behavior encapsulation?

### Indirection (Dimension 2)

**Level 1 — Targeted abstraction:**

- [ ] Does this component have (or concretely need) multiple implementations that must be swappable?
- [ ] Does a dependency cross a deployment boundary (e.g., external service)?
- [ ] Is a test double needed that cannot be achieved without an interface (e.g., calling an external service)?
- [ ] Is an external system's model leaking into and distorting the domain model?
- [ ] Does an external API return data in a shape that does not match domain concepts?
- [ ] Does a change in one component force an unrelated change in another?
- [ ] Does persistence technology need to change and the domain should not be affected?

**Level 2 — Ports & adapters (hexagonal):**

- [ ] Do multiple adapters exist for the same port (with no suitable platform abstraction available)?
- [ ] Is it too complex to test the domain in isolation from real infrastructure?
- [ ] Are there many distinct infrastructure concerns (persistence, messaging, external APIs) that would clutter the
  domain?

### Communication (Dimension 3)

**Level 1 — Domain events (in-process):**

- [ ] Does one action trigger multiple independent side effects that change independently of the triggering action?
- [ ] Are there circular dependencies that events would resolve?

**Level 2 — Async messaging (broker):**

- [ ] Must components be deployed and scaled independently?
- [ ] Is temporal decoupling required (sender must not wait for receiver)?
- [ ] Does the system span multiple processes or services?

### Package Structure (Dimension 4)

**Level 1 — Package dependency tests:**

- [ ] Are accidental cross-package dependencies appearing?
- [ ] Do changes in one package unexpectedly break another?
- [ ] Are package responsibilities becoming blurred?
- [ ] Are there dependency cycles between packages?

**Level 2 — Modulith:**

- [ ] Are there too many package dependencies to hold in your head?
- [ ] Are dependency tests alone insufficient to maintain isolation?
- [ ] Do teams need stronger encapsulation with explicit public APIs per module?
- [ ] Is independent module testing with enforced visibility needed?

**Level 3 — Microservices:**

- [ ] Do modules need independent scaling?
- [ ] Do modules need independent development teams?
- [ ] Do modules have fundamentally different security requirements?

### Error Handling (Dimension 5)

**Level 1 — Result types:**

- [ ] Are there expected failure cases that are not truly exceptional (e.g., validation of user input)?
- [ ] Must callers distinguish between multiple failure modes to make decisions?
- [ ] Does exception-based control flow obscure the business logic?

**Level 2 — Circuit breakers / resilience:**

- [ ] Is an external dependency unreliable and must failures be contained?
- [ ] Are cascading failures a real risk (not hypothetical)?
- [ ] Must the system degrade gracefully under partial failure?

## Post-Unfolding Checks

After unfolding, verify:

- [ ] All tests still pass
- [ ] The code is simpler to understand (not just "more structured")
- [ ] You can state the reason for unfolding in one sentence
- [ ] Only one dimension was changed
