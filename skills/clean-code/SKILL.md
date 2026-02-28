---
name: Clean Code
description: >
  This skill should be used when the user asks to "refactor code", "review code quality",
  "apply clean code principles", "check for code smells", "improve code design",
  "do a clean code review", "apply SOLID principles", "fix naming", "reduce complexity",
  or when performing the refactor phase of a TDD cycle.
version: 0.1.0
---

# Clean Code Principles

Disciplined development approach for writing high-quality, maintainable code.
This skill is language-agnostic; language-specific conventions come from separate skills.

## Philosophy

- **Investment in Low Cost of Change**: Clean code enables continuous modification without exponential complexity growth
- **Boy Scout Rule**: Always leave code cleaner than you found it
- **Simplicity (KISS)**: Always prefer the simpler solution
- **Root Cause Analysis**: Fix problems at their source, not symptoms

## Core Principles (Always Apply)

### 1. Loose Coupling

Components know little about each other. Dependencies flow through well-defined APIs.
Changes in one component minimally affect others. Prefer composition over inheritance.
Depend on abstractions, not concretions.

### 2. High Cohesion

Elements that belong together stay together. Each module has a single, well-defined purpose.
Related functionality is grouped. Unrelated functionality is separated.

### 3. Change is Local

Modifications are contained within boundaries. A feature change affects minimal files/modules.
Stable interfaces protect implementations.

### 4. It is Easy to Remove

Delete dead code immediately. Remove unused abstractions. Eliminate unnecessary features.
Code should be easy to delete, not just easy to add.

### 5. Mind-sized Components

Functions: one screen or less. Classes: under 100 lines as a guideline.
If it cannot be held in working memory, it is too big.

## Refactoring Priority Order

When reviewing or refactoring code, follow this priority order:

### Priority 1: Naming (CRITICAL)

- Evaluate all names for descriptiveness and intent
- Check abstraction level of names
- Rename if purpose has evolved, e.g., through new tests
- Ensure names reveal side effects if any exist
- No encodings or prefixes (no Hungarian notation, no `I` prefix for interfaces)
- Long names for long scopes, short names for short scopes
- **Name helpers by what they do, not what they omit** — e.g. `repositoryWithLocalTempDir()` (describes the
  distinguishing characteristic) instead of `repositoryWithDefaults()` (vague, describes absence of configuration)

### Priority 2: Code Smells Detection

- Duplication (DRY principle)
- Long methods (>20 lines is suspicious)
- Complex conditionals (can they be encapsulated?)
- Feature envy (methods using other classes more than their own)
- Primitive obsession (should primitives be objects?)
- Magic numbers/strings (extract to constants)
- Data clumps (same group of data appearing together)

### Priority 3: SOLID Principles

- **SRP**: Does each class have one reason to change?
- **OCP**: Can behavior be extended without modifying existing code?
- **LSP**: Are subtypes properly substitutable?
- **DIP**: Do high-level modules depend on abstractions?
- **ISP**: Are interfaces client-specific (no "fat" interfaces)?

### Priority 4: Method Design

- One thing per method at one level of abstraction
- Argument count: 0-2 ideal, 3+ needs refactoring
- No flag/boolean arguments (split into separate methods)
- No output arguments (change object state instead)
- Command-Query Separation (do OR know, not both)
- Methods should be small (5-20 lines guideline)
- Order by flow: public method first, helpers follow in call order

### Priority 5: Structure

- Loose coupling, high cohesion, local change
- Remove dead code (unused methods, commented code)
- Check dependencies (no cycles, proper direction)
- Ensure mind-sized components

## Refactoring Patterns

### Reconcile Differences

When duplication with slight variations is found, extract the variation into parameters
and unify the common structure.

### Isolate Change

Wrap unstable or external dependencies. Create abstractions around things that might change.
Only do this if it also simplifies the code.

### Small Refactorings with Working Code In-Between

Never break tests during refactoring. Make tiny changes, run tests.
If tests fail, undo and take smaller steps.

### Encapsulate Conditionals

Extract complex conditions into well-named methods.
Example: `if (timer.hasExpired() && !timer.isRecurrent())` becomes `if (shouldBeDeleted(timer))`

## Exception Handling

- Catch the most specific exception possible
- Catch only where a meaningful reaction is possible or important context can be added
- Use exceptions, not return codes or null (consider Result Object for business states)
- Fail fast: detect and report errors early
- Never swallow exceptions

## Design for Testability

- Constructors should be simple (assign dependencies, do not construct them)
- Dependencies must live as long or longer than the dependent
- Wrap external dependencies (file systems, databases, networks)
- Use test doubles effectively (fakes, mocks, stubs)

## Test Code Quality

- Test code is production code: apply the same quality standards
- One test checks one feature (multiple assertions for same feature are fine)
- Build test domain specific language (builders, fluent APIs, custom assertions)
- FIRST properties: Fast, Isolated, Repeatable, Self-Validating, Timely

## Quick Reference Checklist

For a complete refactoring checklist, consult:

- **`references/checklist.md`** - Read this checklist to verify all clean code principles have been applied during
  refactoring
