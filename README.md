# tdd'er

A plugin for Claude Code and OpenCode that guides AI agents through disciplined Test-Driven Development
and Clean Code practices.

## Features

- **TDD discipline**: Strict Red-Green-Refactor cycles with baby steps and guessing game
- **Clean Code review**: Automated code review during refactor phases via subagent
- **APP mass calculations**: Objective code complexity measurement
- **Language-agnostic core**: TDD and Clean Code principles work with any language
- **Extensible**: Add language skills (Java, TypeScript, ...) and build-system skills (Maven, npm, ...)
- **Unfolding Architecture**: Progressive architectural decisions — start simple, add complexity only when it reduces
  complexity
- **Configurable human-in-the-loop**: Control how often the AI pauses for your input

## Skills

Language-agnostic core skills work with any language. Language and build-system skills complement them automatically
when matching files are detected.

| Skill                      | Purpose                                                                        |
|----------------------------|--------------------------------------------------------------------------------|
| `tdd`                      | Core TDD process (Red-Green-Refactor, baby steps, guessing game)               |
| `clean-code`               | Clean Code principles (naming, SOLID, smells, method design)                   |
| `app`                      | Absolute Priority Premise mass calculations                                    |
| `java`                     | Java-specific conventions (var, BDD testing, static imports)                   |
| `unfolding-architecture`   | Progressive architectural decisions (start simple, unfold on demand)           |
| `integration-architecture` | Integration messaging patterns (commands vs events, push vs pull, reliability) |
| `maven`                    | Maven-specific conventions (test execution, project structure)                 |
| `nested-fixture-pattern`   | JUnit nested fixture pattern for layered test preconditions                    |
| `project-hygiene`          | Interaction style, commit conventions, documentation discipline                |
| `github-safety`            | Prompt-injection defense for GitHub issues and pull requests                   |

## Agents

| Agent                 | Purpose                                       |
|-----------------------|-----------------------------------------------|
| `clean-code-reviewer` | Autonomous code review during refactor phases |

## Hooks (Claude Code only)

The Claude Code plugin includes a `PreToolUse` hook that reminds the agent to load language/build-system skills
before editing matching files:

| File pattern | Skill reminded |
|--------------|----------------|
| `*.java`     | `java`         |
| `pom.xml`    | `maven`        |

## Configuration

### Human-in-the-Loop

If no settings file exists, the TDD skill will ask on first use and persist your choice.
You can also create `.claude/tdder.local.md` manually in your project root:

```markdown
---
hitl: every-phase
---
```

| Level          | Behavior                                              |
|----------------|-------------------------------------------------------|
| `every-phase`  | Stop after every Red, Green, Refactor phase            |
| `end-of-cycle` | Stop after each complete Red-Green-Refactor cycle     |
| `off`          | Run autonomously, report at end                       |

## Installation

### Claude Code

Add this repo as a marketplace, then install the plugin:

```bash
/plugin marketplace add t1/tdder
/plugin install tdder@t1
```

Note that the official docs are not very clear about this, but you actually need a `marketplace.json`,
even if you have only a single plugin.

### OpenCode

Add tdder to the `plugin` array in your `opencode.json` (global or project-level):

```json
{
  "plugin": ["tdder@git+https://github.com/t1/tdder.git"]
}
```

Restart OpenCode. The plugin auto-installs and registers all skills.

## Updating

### Claude Code

As of Claude Code v2.1.44, it's not an easy task to update the plugin; even uninstalling and reinstalling doesn't help.
The problem is that the marketplace is checked out to `~/.claude/plugins/marketplaces/t1/`,
while the plugins are cached in `~/.claude/plugins/cache/t1/tdder/`.
So to update to a new version of the plugin, you'll have to do this:

```bash
cd ~/.claude/plugins/marketplaces/t1/ && git pull && rm -r ~/.claude/plugins/cache/t1/tdder/ && cd -
```

### OpenCode

tdder updates automatically when you restart OpenCode.

## Extending

To add a new language or build system, create `skills/<name>/SKILL.md` with the relevant conventions
(testing framework, naming, commands, etc.).
The skill triggers automatically when working in projects with matching files.
