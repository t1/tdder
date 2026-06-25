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

**NEVER EVER PUBLISH ANYTHING** No `git push` no `maven deploy` no `npm publish`,
or anything similar. All that is the user's privilege!

## Interaction Style

- Always give brief, to-the-point, and concise answers; a single-line answer is often perfectly fine!
- Generally follow the YAGNI principle: don't hypothesise about long term consequences.
- Be critical and honest. The user can always be wrong, and it's not impolite to say so.
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

**VERY IMPORTANT**: if any skill you where instructed to load can't be loaded, stop immediately!
Something's wrong that needs to be fixed first.

## Plan Execution

When executing a plan: if a technology or dependency from the plan doesn't work as expected,
**STOP and discuss with the user.** Do not substitute alternative libraries, frameworks, or
architectural approaches. The plan's tech choices are constraints, not suggestions.

## Temporary Folders

**Never** use the global `/tmp` folder; create an ignored folder within the project.
If there is already a natural temporary folder, e.g. `target/` for a maven project, use that.

## Testing

**A test is a caller — it gets exactly what a real caller gets, no more.**

**If any of these rules feel hard to follow, that is a design signal — not a reason to look for workarounds.** Ask
whether the module can be deepened, the API extended, or the data model rethought. A well-designed unit is easy to test
through its public interface.

- **Tests live outside the boundary they test.**
    - For acceptance, integration, and similar tests: the boundary is the system's externally accessible API (REST,
      GraphQL, CLI, message queue, etc.).
    - For unit tests: the boundary is the language's natural encapsulation unit — a package in Java/Kotlin, a module in
      Python or JavaScript, a crate in Rust. Unit tests cover the unit's public interface, not individual classes.
      Package-private helpers must be freely extractable, inlineable, or renamed without breaking any test. Place test
      code in a separate package/module so the compiler enforces this structurally.

- **Never access the database or repository layer from test code.** If something isn't reachable through the public API,
  ask first whether it has general value and belongs there. If not — or if exposing it would be a security risk — use a
  backdoor: implement it so it is structurally excluded from the production artifact where the stack allows it (e.g. a
  Maven `src/dev/` source root compiled only in dev/test profiles). When structural exclusion isn't possible, guard it
  at runtime (environment variable, feature flag) — but be explicit that this is less safe and can be misconfigured.
  Never put backdoor code in the main source tree.

- **Use test-generated data.** Create everything the test needs through API calls. Do not rely on pre-loaded state: seed
  files, import scripts, and data created by other tests are all off-limits. The only exception is *static domain
  data* — data that would not change if any user or business process acted on the system (e.g. country codes, permission
  roles). Dynamic data — anything a user or process can create, update, or delete — must be created by the test itself.

- **Design tests to be independent.** Scope assertions to data the test created — filter by test-generated unique IDs
  rather than asserting on global counts or lists of dynamic data. Even before/after deltas are unsafe when tests run in
  parallel. If you find yourself counting dynamic things, stop and question the design: can the query be scoped? If not,
  the data model or API may need rethinking. Independent tests can run in parallel; tests that require a clean slate
  usually signal a deeper design problem.

## Tool Use

*Always* prefer to use the `WebFetch` tool over `curl`.

*Always* prefer the `Write` tool over `cat > file << EOF`.

*Never* use `find ... -exec`; it triggers a question that can't be auto-allowed.
