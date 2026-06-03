# TDD Failure Modes and Recovery

## Common Failure Modes

### 1. Planning Beyond Base Functionality

**Symptom**: Initial test list includes advanced features instead of focusing on core functionality.

**Example**: For a String Calculator, including "custom delimiters" and "ignore >1000" in the initial
test list rather than just empty string, single number, two numbers, multiple numbers.

**Recovery**: Strip the test list to the simplest base functionality. Advanced features emerge
naturally after the base is solid.

### 2. Multiple Active Tests

**Symptom**: Converting more than one pending test to executable test code at once.

**Recovery**: Revert all but one test to pending. Activate tests one at a time, strictly.

### 3. Implementing Beyond Tests

**Symptom**: Adding features or logic not demanded by the current failing test.

**Example**: Adding input validation when the current test only needs basic addition.

**Recovery**: Delete the extra code. If it has no test, it should not exist.

### 4. Skipping Predictions

**Symptom**: Running tests without explicitly stating expected failures.

**Recovery**: Stop. State the prediction. Run the test. Compare. This builds understanding
and catches misconceptions early.

### 5. Avoiding Refactoring

**Symptom**: Moving to next test without attempting at least one improvement.

**Recovery**: Force yourself to evaluate naming, duplication, and complexity. If no improvement
is possible, document why the current state is optimal.

### 6. Premature Abstraction

**Symptom**: Creating complex solutions (interfaces, factories, strategies) when simple functions
or hardcoded values pass tests.

**Recovery**: Delete the abstraction. Use the simplest thing that works. Abstractions should
emerge from duplication, not be planned in advance.

## Why These Failures Happen

TDD practices are counterintuitive:

- **Hardcoded returns feel "too simple"**: Returning `0` or `1` seems wasteful, but it is the
  correct minimal step
- **The urge to implement ahead is strong**: Solving multiple test cases at once feels efficient
  but introduces unverified complexity
- **Minimal steps feel inefficient**: Tiny steps seem slow but actually accelerate development
  by preventing dead ends
- **Predictions feel unnecessary**: Stating what will fail seems obvious, but builds crucial
  understanding of the system

## Recovery Strategy

When a failure mode is detected:

1. Stop immediately
2. Identify which mode was triggered
3. Revert to the last known-good state (all tests passing)
4. Restart the current TDD cycle with discipline
5. Document the failure mode for awareness
