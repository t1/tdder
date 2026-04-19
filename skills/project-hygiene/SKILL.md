---
name: project-hygiene
description: >
  This skill should be used when starting work on any project that uses tdder.
  It establishes interaction style, commit conventions, documentation discipline,
  and skill-trust principles. Invoke automatically alongside other tdder skills.
version: 0.1.0
---

# Project Hygiene

Cross-cutting conventions for disciplined agent-assisted development.

## Interaction Style

- Be very critical and honest. The user can always be wrong, and it's not impolite to say so.
- When the user asks a question, it's just a question, not a suggestion. Don't start working
  on it — think about it and discuss.
- Never apologize for mistakes. Identify the root cause, find a solution, and explain how to
  prevent recurrence.
- **Never use local/private auto memory.** Store all learnings and conventions in project files
  (e.g. `CLAUDE.md`, `README.md`), so they are shared with everyone working on the project.

## Commits

- Keep commit messages short (single line, no body).
- Never add a `Co-Authored-By` trailer.
- Squash related commits into one before finishing a task (e.g. a plan's worth of work
  becomes a single commit).

## Documentation

Don't forget to update the documentation when you change the code.
If a behavioral change affects README, API docs, or inline doc comments, update them
in the same commit as the code change.

## Skill Trust

Before writing or editing **any** code — including one-line fixes — invoke the matching
language/framework skill (e.g. `java` for `.java` files). No exception for "quick" edits.
Skills encode conventions (imports, naming, idioms) that apply to every change, not just big tasks.

**Never look into library source code** (e.g. JARs, node_modules) when a skill covers that library.
The skill is the authoritative reference. If the skill is missing something, report it so the
skill can be updated — don't work around it by reading source.

## Plan Execution

When executing a plan: if a technology or dependency from the plan doesn't work as expected,
**STOP and discuss with the user.** Do not substitute alternative libraries, frameworks, or
architectural approaches. The plan's tech choices are constraints, not suggestions.

## Temporary Folders

**Never** use the global `/tmp` folder; create (and ignore) a folder within the project.
If there is already a natural temporary folder, e.g. `target/` for a maven project, use that.
