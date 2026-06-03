# Clean Code Refactoring Checklist

Use this checklist during every refactor phase.

## Names

- [ ] All names are descriptive and unambiguous
- [ ] Names are at appropriate level of abstraction
- [ ] Names reveal any side effects
- [ ] No encodings or prefixes in names
- [ ] Long names for long scopes, short names for short scopes

## Methods

- [ ] Each method does one thing
- [ ] One level of abstraction per method
- [ ] 0-2 arguments (3+ needs refactoring)
- [ ] No flag arguments
- [ ] No output arguments
- [ ] Command-query separation maintained
- [ ] Methods are small (<20 lines guideline)
- [ ] Ordered by flow (public first, helpers follow in call order)

## Code Smells

- [ ] No duplication (DRY)
- [ ] No magic numbers/strings
- [ ] No dead code
- [ ] No commented-out code
- [ ] No long methods
- [ ] No inline comments grouping lines (extract to methods instead)
- [ ] No long parameter lists
- [ ] No feature envy
- [ ] No primitive obsession
- [ ] Conditionals are encapsulated

## SOLID

- [ ] Single Responsibility (one reason to change)
- [ ] Open/Closed (extend without modifying)
- [ ] Liskov Substitution (subtypes substitutable)
- [ ] Dependency Inversion (depend on abstractions)
- [ ] Interface Segregation (client-specific interfaces)

## Structure

- [ ] Loose coupling
- [ ] High cohesion
- [ ] Change is local
- [ ] Easy to remove
- [ ] Mind-sized components
- [ ] Opportunities to reduce visibility (fields, methods, classes, inner classes)

## Tests

- [ ] Tests follow Given-When-Then
- [ ] Test names describe behavior
- [ ] Tests are isolated and independent
- [ ] Tests use domain language
- [ ] Tests are simple and readable
- [ ] Test code quality matches production code quality

## Naming Patterns

### Method Naming

- **Predicates**: `isValid()`, `hasChildren()`, `canExecute()`
- **Queries**: `getName()`, `calculateTotal()`, `findById()`
- **Commands**: `save()`, `delete()`, `execute()`
- **Boolean getters**: `isActive()` not `getActive()`
- **Factory methods**: `createAccount()`, `fromString()`

### General Rules

1. Choose descriptive and unambiguous names
2. Use names at appropriate level of abstraction
3. Long names for long scopes, short for short scopes
4. Names describe side effects
5. No encodings in names
