# DMD Format

Domain Model Decisions live in `docs/dmd/` and use sequential numbering: `0001-slug.md`, `0002-slug.md`, etc.

Create the `docs/dmd/` directory lazily — only when the first DMD is needed.

## Template

```md
# {Short title of the decision}

{1-3 sentences: what's the context, what did we decide, and why.}
```

That's it. A DMD can be a single paragraph. The value is in recording *that* a decision was made and *why* — not in
filling out sections.

## Optional sections

Only include these when they add genuine value. Most DMDs won't need them.

- **Status** frontmatter (`proposed | accepted | deprecated | superseded by DMD-NNNN`) — useful when decisions are
  revisited
- **Considered Options** — only when the rejected alternatives are worth remembering
- **Consequences** — only when non-obvious downstream effects need to be called out

## Numbering

Scan `docs/dmd/` for the highest existing number and increment by one.

## When to offer a DMD

All three of these must be true:

1. **Hard to reverse** — the cost of changing your mind later is meaningful
2. **Surprising without context** — a future reader will wonder "why did they model it that way?"
3. **The result of a real trade-off** — there were genuine alternatives and you picked one for specific reasons

If any of the three is missing, skip the DMD.

### What qualifies

- **Contested term.** Two reasonable people used different words for the same thing, or the same word for different
  things — and a deliberate choice was made.
- **Non-obvious concept boundary.** A decision to split or merge two concepts that could plausibly have gone either
  way (e.g. "Customer and User are distinct; a Customer can have multiple Users").
- **Rejected alternative model.** You considered modeling something as an entity vs. a value object, an event vs. a
  state, a relationship vs. an aggregate — and the rejection is non-obvious.
- **Scope decision.** "Invoice totals are calculated from line items at read time, not stored" — the explicit
  no-s are as valuable as the yes-s.
- **Deliberately deferred concept.** A concept exists in the domain but is consciously excluded from this context
  or bounded-context file for specific reasons.
