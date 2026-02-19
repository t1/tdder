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

Language-agnostic core skills work with any language. Language and build-system skills complement them automatically
when matching files are detected.

| Skill        | Purpose                                                          |
|--------------|------------------------------------------------------------------|
| `tdd`        | Core TDD process (Red-Green-Refactor, baby steps, guessing game) |
| `clean-code` | Clean Code principles (naming, SOLID, smells, method design)     |
| `app`        | Absolute Priority Premise mass calculations                      |
| `java`       | Java-specific conventions (var, BDD testing, static imports)     |
| `maven`      | Maven-specific conventions (test execution, project structure)   |

## Agents

| Agent                 | Purpose                                       |
|-----------------------|-----------------------------------------------|
| `clean-code-reviewer` | Autonomous code review during refactor phases |

## Configuration

### Human-in-the-Loop

Create a `.claude/tdder.local.md` file in your project root:

```markdown
---
hitl: every-phase
---
```

| Level          | Behavior                                              |
|----------------|-------------------------------------------------------|
| `every-phase`  | Stop after every Red, Green, Refactor phase (default) |
| `end-of-cycle` | Stop after each complete Red-Green-Refactor cycle     |
| `off`          | Run autonomously, report at end                       |

## Installation

Add this repo as a marketplace, then install the plugin:

```bash
/plugin marketplace add t1/tdder
/plugin install tdder@t1
```

## Extending

To add a new language or build system, create `skills/<name>/SKILL.md` with the relevant conventions
(testing framework, naming, commands, etc.).
The skill triggers automatically when working in projects with matching files.
