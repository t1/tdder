# tdd'er

A Claude Code plugin that guides AI agents through disciplined Test-Driven Development
and Clean Code practices.

## Features

- **TDD discipline**: Strict Red-Green-Refactor cycles with baby steps and guessing game
- **Clean Code review**: Automated code review during refactor phases via subagent
- **APP mass calculations**: Objective code complexity measurement
- **Language-agnostic core**: TDD and Clean Code principles work with any language
- **Extensible**: Add language skills (Java, TypeScript, ...) and build-system skills (Maven, npm, ...)
- **Configurable human-in-the-loop**: Control how often the AI pauses for your input

## Skills

| Skill | Purpose |
|-------|---------|
| `tdd` | Core TDD process (Red-Green-Refactor, baby steps, guessing game) |
| `clean-code` | Clean Code principles (naming, SOLID, smells, method design) |
| `app` | Absolute Priority Premise mass calculations |
| `java` | Java-specific conventions (var, BDD testing, static imports) |
| `maven` | Maven-specific conventions (test execution, project structure) |

## Agents

| Agent | Purpose |
|-------|---------|
| `clean-code-reviewer` | Autonomous code review during refactor phases |

## Configuration

### Human-in-the-Loop

Create a `.claude/tdder.local.md` file in your project root:

```markdown
---
hitl: every-phase
---
```

**Levels:**

| Level | Behavior |
|-------|----------|
| `every-phase` | Stop after every Red, Green, Refactor phase (default) |
| `end-of-cycle` | Stop after each complete Red-Green-Refactor cycle |
| `off` | Run autonomously, report at end |

## Installation

```bash
# Test locally
claude --plugin-dir /path/to/tdder

# Or symlink into your plugins directory
ln -s /path/to/tdder ~/.claude/plugins/tdder
```

## Adding a New Language

To add support for a new language (e.g., TypeScript):

1. Create `skills/typescript/SKILL.md`
2. Add language-specific conventions (testing framework, naming, imports, etc.)
3. The skill triggers automatically when working in projects with matching files

## Adding a New Build System

To add support for a new build system (e.g., npm):

1. Create `skills/npm/SKILL.md`
2. Add build-system-specific conventions (test commands, project structure, etc.)
3. The skill triggers automatically when working in projects with matching files

## License

MIT
