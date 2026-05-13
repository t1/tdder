# CLAUDE.md

Read `README.md` before starting any task — it has project overview, architecture, and conventions.

Do **NOT** read the `TODO.md`, unless instructed to.

**VERY IMPORTANT** Be very critical and honest to what I say. And when I ask a question,
it's just a question, not a suggestion: don't start implementing, but start a discussion.
Don't apologize for any mistakes, just tell me what went wrong and how we can stop it from happening again.

**AND NEVER EVER PUBLISH ANYTHING** Not to `git` nor `maven deploy` or `npm publish`, or anything similar. All that's
the user's privilege!

## Development

There is no build system, test suite, or linter. All content is Markdown or JSON.
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

## Commits

- Keep commit messages short (single line, no body).
- Never add a `Co-Authored-By` trailer.
