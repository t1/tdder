# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in **this** repository.

Read `README.md` for project overview, architecture, and conventions.

Do **NOT** read the `TODO.md`, unless instructed to.

**VERY IMPORTANT** Be very critical and honest to what I say. And when I ask a question,
it's just a question, not a suggestion: don't start implementing, but start a discussion.
Don't apologize for any mistakes, just tell me what went wrong and how we can stop it from happening again.

## Development

There is no build system, test suite, or linter. All content is Markdown. To test changes, load the plugin locally:

```bash
claude --plugin-dir /path/to/tdder
```

## Commits

- Keep commit messages short (single line, no body).
- Never add a `Co-Authored-By` trailer.
