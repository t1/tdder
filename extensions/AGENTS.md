# Writing pi extensions

Read `README.md` and the root `AGENTS.md` first.

## Prerequisite reading (pi docs)

Before writing or changing any extension, read these in order:

- `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/docs/extensions.md` — extension API
- `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/examples/extensions/` — official examples
- `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/docs/tui.md` — if the extension touches the footer or any UI
- Follow `.md` cross-references the docs link to. Don't stop at the first page.

## Hard rule: do not read sibling extensions

**When writing a new extension, do not read the source of any other extension in this repo.**

This rule lifts only when we have at least two finished extensions to compare. Reasons:

- With n=1, "patterns extracted from the existing extension" are survivor bias, not patterns.
- Copying code without understanding the contract it satisfies generates technical debt.
- The right way to discover real patterns is to write extension #N independently against the pi
  docs, then compare to existing extensions afterward and extract what genuinely repeats.

If you find yourself wanting to peek "just to see how they did X", that's the signal that the
pi docs are missing something or that you're trying to skip a design decision. Solve it directly
instead — ask the pi docs, ask the user, or make a deliberate choice and document why.

## Extension-specific learnings

Patterns that turn out to be specific to one extension live in that extension's own `AGENTS.md`
(e.g. `extensions/idea/AGENTS.md`). Only patterns that are validated across multiple extensions
get promoted to this file.

## To be filled in (after extension #2 exists)

Questions to answer empirically by comparing extensions, not by inventing answers up front:

- State management: where does extension state live, how is it reset between sessions?
- Footer updates: cadence, debouncing, what state transitions deserve a redraw?
- Error forwarding to the LLM: when does a failure auto-bounce back to the LLM vs. surface
  as a notification?
- Slash-command vs tool tradeoffs: which interactions deserve a slash command, which are
  better as MCP-style tools the LLM calls?
- Testing strategy: what's worth a unit test, what needs the real pi runtime?
- Lazy MCP startup patterns: handshake sequence, session lifecycle, reconnection.
- Context auto-injection: which extensions wrap MCP calls to inject implicit context, and
  what's the common shape?

Each of these gets a real answer only once we can compare two independently-built extensions.
