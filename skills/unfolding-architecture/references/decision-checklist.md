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
- [ ] Do the data structures change at a different rate than the algorithms?
- [ ] Would separation reduce the number of reasons each component changes?

### Coupling & Cohesion (Dimension 2)

- [ ] Does this component have (or concretely need) multiple implementations?
- [ ] Does a change in one component force an unrelated change in another?
- [ ] Is a test double needed that cannot be achieved without an interface?

### Layering & Boundaries (Dimension 3)

- [ ] Is an external model leaking into and distorting the domain?
- [ ] Would a translation layer simplify the domain model?
- [ ] Are there multiple infrastructure adapters for the same concern?

### Communication (Dimension 4)

- [ ] Does one action trigger multiple independent side effects?
- [ ] Do the side effects change independently of the triggering action?
- [ ] Are there circular dependencies that events would resolve?

### Persistence (Dimension 5)

- [ ] Is persistence technology likely to change based on current plans?
- [ ] Do read and write models have fundamentally different shapes?
- [ ] Would a repository interface simplify testing?

### Error Handling (Dimension 6)

- [ ] Are there expected failure cases that are not truly exceptional?
- [ ] Must callers distinguish between multiple failure modes?
- [ ] Is an external dependency unreliable enough to warrant resilience patterns?

## Post-Unfolding Checks

After unfolding, verify:

- [ ] All tests still pass
- [ ] The code is simpler to understand (not just "more structured")
- [ ] You can state the reason for unfolding in one sentence
- [ ] Only one dimension was changed
