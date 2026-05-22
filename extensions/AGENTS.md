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

**Exception:** workarounds for pi-API gaps that don't depend on the extension's domain (MCP,
IDE, debugger, etc.) may be promoted at n=1. The rationale is that the next extension author
will re-derive the same workaround from the same pi-API gap regardless of what their extension
does. If a workaround instead encodes a design choice (caching strategy, footer cadence, error
classification, etc.), it stays in the extension's own AGENTS.md until n≥2 confirms.

## Cross-extension patterns

### Styled in-chat output that's not sent to the LLM

**Problem:** pi has no first-class "display-only" message. `ctx.ui.notify` is unstyled and
transient. `ctx.ui.setWidget` pins above the editor (no scrolling, no natural dismissal).
`pi.sendMessage` with `display: true` does render in chat with full theming — but
`convertToLlm` in `pi-coding-agent/dist/core/messages.js` unconditionally turns custom
messages into `user` messages for the next LLM call. The `display` field controls TUI
visibility only, not LLM inclusion. There is no `excludeFromContext` flag on `CustomMessage`
(only `BashExecutionMessage` has one).

**Workaround:** combine three pi APIs.

1. `pi.sendMessage({ customType, display: true, content, details })` — puts a scrolling
   entry in the chat log. `content` is a plain-text fallback used only if the renderer
   is gone (extension uninstalled mid-session).
2. `pi.registerMessageRenderer(customType, (msg, _opts, theme) => Component)` — styles
   the entry with `theme.fg(...)`, `theme.bold(...)`, etc. Wrap in `Box(1, 1, t =>
   theme.bg("customMessageBg", t))` to match the built-in custom-message frame.
3. `pi.on("context", event => { ... return { messages: filtered } })` — filter your
   own `customType` out of the messages array right before each LLM call. Return
   `undefined` (not `{ messages: event.messages }`) when nothing was filtered, to keep
   the hot path cheap.

Used by: `idea` (`/idea tools` listing, `customType: "idea-tools"`).

**Caveats:**

- Each extension must pick a `customType` namespace that won't collide with others.
- The context filter runs on every LLM call. Keep it O(n) and allocation-light.
- pi-tui (`Box`, `Text`) is a separate package from pi-coding-agent; add
  `@earendil-works/pi-tui` to `peerDependencies` and `devDependencies` to import it.
- Promote to a first-class pi API if/when the gap closes upstream; until then, document
  it here so the next extension author doesn't re-derive it from scratch.

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
- **Debug logging convention.** The `idea` extension uses `IDEA_MCP_DEBUG_FILE=<path>`
  for opt-in debug output. Path comes from the env var; file is append-only;
  format is unstable; pi's TUI swallows `console.error`, so file output is the only
  user-visible diagnostic. If a second extension adopts the same shape
  (`<TOOL>_<TARGET>_DEBUG_FILE`), promote the pattern to a shared rule here.
  (Not promoted under the n=1 exception because the env-var name shape encodes a
  naming choice, not a pi-API workaround.)

Each of these gets a real answer only once we can compare two independently-built extensions.
