---
name: Test-Driven Development
description: >
  This skill should be used when the user asks to "add a feature using TDD", "fix a bug with TDD",
  "do TDD", "red-green-refactor", "write a failing test first", "use test-driven development",
  "start TDD", "test first approach", "TDD loop", "TDD cycle",
  or mentions TDD workflow, baby steps, guessing game, or red-green-refactor cycles.
  Not applicable for pure refactoring without new tests.
---

# Test-Driven Development (TDD)

Strict Red-Green-Refactor discipline for adding features and fixing bugs.
This skill is language-agnostic; language-specific conventions are provided by separate skills.

## Core Process

### 1. Test List First

Create a list of test cases for **base functionality only** before writing any implementation.
Use the language's equivalent of pending/todo tests (e.g., `it.todo()`, `@Disabled`, `@Ignore`).
Focus on core functionality, not advanced features.

### 2. One Test at a Time

Convert exactly **one** pending test to executable test code at a time.
All other tests remain as pending descriptions.
Never have more than one failing test in the red phase.
Implement only what is needed to make that single test pass.
Do not think ahead or implement features for future tests.

### 3. Red-Green-Refactor Cycle

#### Red Phase (Compilation Error)

Start with a non-existent function/class. The test should fail with a compilation error.
This ensures a true start from scratch.

#### Red Phase (Runtime Error)

Create an empty function that returns a wrong value.
The test should fail with an assertion error, verifying the test works as expected.

#### Green Phase

Implement **minimal** code to make the test pass.
Do not add features for future tests. Do not optimize or refactor yet.

#### Refactor Phase

**Must** attempt at least one refactoring. If no improvement is possible, document why.

Trigger a **Clean Code Review**: use the Agent tool with `subagent_type=clean-code-reviewer` to spawn
the clean code review agent. Pass it the paths of the implementation and test files modified in this
TDD cycle.

Apply the returned suggestions, ensuring all tests continue to pass after each change.

**Naming evaluation (first priority):**

- Ask: "Does this name clearly describe what the function actually does based on all tests so far?"
- Ask: "Has the function's purpose become clearer/more specific through the latest test?"
- Rename if the name does not capture the current full intent.

Apply the 4 Rules of Simple Design: tests pass, no duplication, reveals intent, fewest elements.

If no refactoring improves the code, document why the current state is optimal and move on.

### 4. Guessing Game

Before running tests, explicitly state:

- Which test will fail
- Type of error (compilation/assertion)
- Expected vs actual values
- Expected diff output

Run the test, then compare the actual result with the prediction.

### 5. Baby Steps

Make the smallest possible change to get to green.
If a test fails, make it pass with the simplest implementation.
Do not try to solve multiple problems at once.

## Human-in-the-Loop

Check the project's `.claude/tdder.local.md` settings file (in the project root) for the
human-in-the-loop level. If no settings file exists, default to `every-phase`.

### Level: `every-phase`

Stop after **every TDD phase** (Red, Green, Refactor). Summarize what was completed and
explicitly ask for permission to continue:

- After Red: "Red phase complete. Should I proceed to Green phase?"
- After Green: "Green phase complete. Should I proceed to Refactor phase?"
- After Refactor: "Refactor phase complete. Should I proceed to the next test?"

### Level: `end-of-cycle`

Stop after each **complete Red-Green-Refactor cycle**. Summarize the full cycle and ask:
"Cycle complete. Should I proceed to the next test?"

### Level: `off`

Run autonomously without stopping. Report results at the end.

### Failed Prediction Recovery

Regardless of level, **immediately stop** when a guessing game prediction fails significantly.
Explain the prediction failure, assess implications, and ask whether to investigate further
or continue.

## Phase Summaries

When stopping for human review, include:

**After Red Phase:**
- Which test was activated
- Prediction made and whether it was correct
- Type of failure achieved (compilation/runtime error)

**After Green Phase:**
- Implementation approach taken (minimal code added)
- Confirmation that test now passes
- Trade-offs or decisions made

**After Refactor Phase:**
- Naming changes made
- Mass calculations (before/after, if APP skill is available)
- Structural improvements
- Refactoring opportunities rejected and why

## TDD Mindset

TDD practices will feel counterintuitive and uncomfortable. This discomfort indicates the discipline
is being followed correctly. For detailed analysis of psychological resistance, common failure modes,
and recovery strategies, see `references/failure-modes.md`.

## Best Practices

- One assertion per test when possible
- Clear, descriptive test names
- Tests should be independent (no shared state)
- Start with the simplest possible implementation
- Tests serve as documentation

## Additional Resources

### Reference Files

For detailed guidance on specific aspects:
- **`references/failure-modes.md`** - Detailed failure mode analysis and recovery strategies
