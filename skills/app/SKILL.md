---
name: Absolute Priority Premise (APP)
description: >
  This skill should be used when the user asks to "calculate code mass", "measure code complexity
  with APP", "compare implementations using APP", "apply Absolute Priority Premise",
  "use mass calculations", or during TDD refactor phases when comparing alternative implementations.
  Based on Micah Martin's work.
version: 0.1.0
---

# Absolute Priority Premise (APP)

Objective heuristic for comparing code quality by assigning mass values to code components.
Lower total mass indicates simpler code.

## The Six Components

| Component   | Mass | Examples                            |
|-------------|------|-------------------------------------|
| Constant    | 1    | `5`, `"hello"`, `true`, `[]`        |
| Binding     | 1    | `amount`, `userName`, `result`      |
| Invocation  | 2    | `calculate()`, `Math.max(a, b)`     |
| Conditional | 4    | `if`, `switch`, `case`, `?:`        |
| Loop        | 5    | `while`, `for`, `forEach`, `map`    |
| Assignment  | 6    | `x = 5`, `count++`, `list.add()`    |

## Calculation

```
Total Mass = (constants x 1) + (bindings x 1) + (invocations x 2)
           + (conditionals x 4) + (loops x 5) + (assignments x 6)
```

**Lower mass = Better code** (all else being equal).

## Special Counting Rules

- **Method declarations** count as Constant (1) + Binding (1)
- **Class definitions** count as Constant (1) + Binding (1) (usually ignored in comparisons)
- **`final` fields and local variables** are Bindings (1), not Assignments (6)
- Only **re-assignments that modify values** count as Assignment (6)

## Integration with TDD

- **Red Phase**: Mass is irrelevant (focus on passing tests)
- **Green Phase**: Minimal code naturally has low mass
- **Refactor Phase**: Use APP to guide toward simpler solutions

## Integration with Simple Design

1. **Tests Pass** (Rule #1) - Always highest priority
2. **Reveals Intent** (Rule #2) - May increase mass for clarity
3. **No Duplication** (Rule #3) - Extract to reduce mass
4. **Fewest Elements** (Rule #4) - Aligns with low mass goal

**Simple Design Rule #2 trumps APP** - Choose clarity over low mass.
APP helps choose between equivalent clear solutions.

## When to Apply

- During refactoring to choose between working solutions
- When comparing algorithms of similar functionality
- To guide toward simpler implementations

## When NOT to Apply

- Never sacrifice clarity for lower mass
- Do not optimize prematurely based on mass alone
- Performance requirements may override mass considerations
- Domain complexity may require higher mass solutions

## Limitations

- Not a direct indication of readability
- Ignores performance characteristics
- Validity unclear for general-purpose code (best for algorithm comparisons)
- Favors functional programming due to loop/assignment penalties
- The best specific mass values are unknown; these are Micah's suggested weights

## Sources

- [Micah Martin - Transformation Priority Premise Applied](https://8thlight.com/insights/transformation-priority-premise-applied) (2012)
- [Peter Kofler - Absolute Priority Premise, an Example](https://blog.code-cop.org/2016/08/absolute-priority-premise-example.html)
