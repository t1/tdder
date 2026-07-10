# AGENTS.md

Read `README.md` before starting any task — it has project overview, architecture, and conventions.

Do **NOT** read the `TODO.md`, unless instructed to.

**VERY IMPORTANT** Be very critical and honest to what I say. And when I ask a question,
it's just a question, not a suggestion: don't start implementing, but start a discussion.
Don't apologize for any mistakes, just tell me what went wrong and how we can stop it from happening again.

**AND NEVER EVER PUBLISH ANYTHING** — no `git push`, `maven deploy`, `npm publish`, or anything that sends
code or artifacts to a remote. All that's the user's privilege!

## File locations

**`~/.pi/agent/git/github.com/t1/tdder/` is a read-only checkout of this project — NEVER edit or commit there.**
The current working directory is the real repo. Always resolve skill file paths relative to CWD, not to the read-only
checkout.

## Claude Code vs pi

Claude Code agents cannot use tools provided by pi extensions (e.g. `maven_run`,
`maven_project_info`, `maven_lookup_version`). They must use the equivalent
`tdder-maven` CLI commands via `bash` instead. The skill files document both
approaches.

## Development

Most content is Markdown or JSON with no build step. However, the `extensions/maven/`
subdirectory is a TypeScript project with a test suite — see its own README for details.

When doing TDD on the maven extension, load and follow the `tdd` skill.

Root dependency sections in `package.json` (`dependencies`, `devDependencies`,
`peerDependencies`, `optionalDependencies`) are generated from the union of the same
sections in `extensions/*/package.json`. There is currently no mechanism for manual
root-only entries in those sections. After changing an extension dependency section,
run `npm run sync-root-deps` and keep `package-lock.json` in sync.

Separately released pi extension packages vendor shared TypeScript into the package at
sync time instead of publishing a separate shared package. In this repo, `pretest` and
`prepack` are safety nets, not the normal development workflow: after every edit to
shared code or to a consumer of that shared code, run `npm run sync-extensions`
immediately before continuing.

If you change any extension's `scripts.sync`, re-run and verify `npm run sync-extensions`
from the repo root, not just the extension-local sync command.

When a test restores a child session via `restoreChildSession(...)`, always call the returned
`shutdown()` in test cleanup. Restored child sessions bind sibling extensions (including `idea`),
and skipping `shutdown()` leaks extension resources such as IDEA MCP sockets/timers and makes
Node tests hang after all assertions already passed.

To test changes, load the plugin locally:

```bash
claude --plugin-dir /path/to/tdder
```

or

```bash
pi --extension /path/to/tdder
```

## Dual-platform agents

The `clean-code-reviewer` agent exists in two copies with different formats:

- `agents/clean-code-reviewer.md` — Claude Code format
- `.opencode/agents/clean-code-reviewer.md` — OpenCode format

Keep them in sync when changing review criteria.

The Unfolding Specs role agents also exist in two variants:

- `agents/unfolding-<role>.md` — Claude Code / OpenCode format (uses `Agent()`, `SendMessage`, team API)
- `extensions/unfolding/roles/<role>.md` — pi format (uses `task_finished`, `task_block`; no messaging)

When changing role behaviour (process steps, constraints, domain rules), update **both** variants.
When changing only the coordination mechanics (how agents signal completion or block), update only
the relevant variant.

## Commits

- Keep commit messages short (single line, no body text).
- Never add a `Co-Authored-By` trailer.
