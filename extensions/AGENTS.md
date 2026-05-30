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

### Vendored shared TypeScript for separately released extensions

Separately released extension packages in this repo vendor shared TypeScript from
elsewhere in the repo instead of publishing a separate shared package. Treat the sync
step as mandatory development hygiene.

#### Sync contract

- The extension must expose a `scripts.sync` command in its `package.json`.
- `scripts.sync` must be idempotent.
- `pretest` and `prepack` must delegate to that same sync command; don't duplicate the
  sync logic in multiple scripts.
- `scripts.sync` may update only generated/vendor files for that extension. It must not
  have unrelated side effects elsewhere in the repo.
- Never edit generated vendored files directly; edit the canonical source, then sync.

#### Workflow

- `pretest` and `prepack` are only backstops.
- After every edit to shared code or to a consumer of that shared code, run
  `npm run sync-extensions` from the repo root immediately.
- Do not keep working against a stale vendored copy and assume packaging will fix it
  later.


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

Used by: `idea` (`/idea tools` listing), `quarkus` (info and startup-log displays), `maven`
(all `/maven` output).

**Exception:** a custom message whose `content` IS the LLM prompt (e.g. `quarkus-test`
messages that set `triggerTurn: true`) must NOT be filtered — filtering it removes the
prompt from the LLM before it can act on it. Only filter pure display-only messages
(those with `content: ""` and `triggerTurn: false`).

**Caveats:**

- Each extension must pick a `customType` namespace that won't collide with others.
- The context filter runs on every LLM call. Keep it O(n) and allocation-light.
- pi-tui (`Box`, `Text`) is a separate package from pi-coding-agent; add
  `@earendil-works/pi-tui` to `peerDependencies` and `devDependencies` to import it.
- Promote to a first-class pi API if/when the gap closes upstream; until then, document
  it here so the next extension author doesn't re-derive it from scratch.

### Footer status icons (n=2: quarkus, idea)

Both extensions use a consistent three-symbol vocabulary for the pi footer.
Adopt this in all future extensions that reflect connection or process state:

| Symbol | Meaning               | Example                              |
|--------|-----------------------|--------------------------------------|
| `●`    | healthy / connected   | `idea ●`, `quarkus ● :8080`          |
| `◌`    | transitioning/starting | `quarkus ◌ starting…`               |
| `⚠`    | degraded / warning    | `idea ⚠ not open`, `quarkus ⚠ crashed` |
| (blank) | absent / not active  | `ctx.ui.setStatus(key, undefined)`   |

Use one stable key per extension (e.g. `"idea"`, `"quarkus-app"`). Update it on every
state transition; clear it to `undefined` when the extension has nothing to show.

### Slash command subcommand dispatch (n=3: quarkus, idea, maven)

All three follow the same skeleton:

```typescript
const SUBCOMMANDS = ["foo", "bar"] as const;
const DESCRIPTIONS: Record<string, string> = { foo: "…", bar: "…" };

pi.registerCommand("x", {
  getArgumentCompletions: (prefix) =>
    SUBCOMMANDS
      .filter(s => s.startsWith(prefix))
      .map(s => ({ value: s, label: s, description: DESCRIPTIONS[s] })),
  handler: async (args, ctx) => {
    const [sub, ...rest] = (args?.trim() ?? "").split(/\s+/);
    const extra = rest.join(" ") || undefined;
    // dispatch on sub
  },
});
```

Define `SUBCOMMANDS` and `DESCRIPTIONS` as a single source of truth so completions
and error messages never drift apart.

### Session lifecycle invariant (n=3)

Every resource acquired in `session_start` must be released in `session_shutdown`:

- Every `setInterval` → `clearInterval` in shutdown
- Every MCP client started → `.close()` in shutdown
- Every `ctx.ui.setStatus(key, v)` → `ctx.ui.setStatus(key, undefined)` in shutdown
- Every `ctx.ui.setWidget(key, v)` → `ctx.ui.setWidget(key, undefined)` in shutdown

State accumulated across MCP calls (tool lists, app state) lives as `let` variables
inside the `export default function(pi)` closure. It persists across
`session_start`/`session_shutdown` cycles within the same process — it is NOT reset
between sessions. Design accordingly; do not assume a fresh slate on each `session_start`.

### Error forwarding to the LLM (n=2: quarkus, maven)

Three tiers, validated by the quarkus `/quarkus` command:

1. **Direct human actions** (non-analytical slash subcommands): call the tool, show the
   result as `ctx.ui.notify`. On failure, forward the error to the LLM via
   `pi.sendUserMessage(…, { deliverAs: "followUp" })` with a structured prompt
   (*"what went wrong and how should I fix it?"*).
2. **Always-analytical subcommands** (test runs, update checks, search): always forward
   output to the LLM regardless of success or failure — the human is not the primary
   consumer of the raw output.
3. **LLM-initiated tool calls**: throw from `execute()`. pi surfaces the error as a tool
   error result; the LLM handles recovery itself.

### Lazy MCP startup (n=2: quarkus, idea)

Both extensions lazy-start their MCP connection; the strategies differ by use case:

**Promise coalescing** (quarkus): best when startup is expensive and multiple callers
may race (e.g. `session_start` fires a background startup while the first tool call
also triggers `ensureClient`).

```typescript
async function ensureClient(cwd: string): Promise<McpClient> {
  if (state.client) return state.client;
  if (!state.pendingStart) {
    state.pendingStart = startClient(cwd).then(c => {
      state.client = c;
      state.pendingStart = null;
      return c;
    });
  }
  return state.pendingStart;
}
```

**Poll-with-inflight-guard** (idea): best when the connection is self-healing via
polling and you want to avoid overlapping health checks.

```typescript
let tickInFlight = false;
async function tick(): Promise<void> {
  if (tickInFlight) return;
  tickInFlight = true;
  try { /* probe, reconnect if needed */ }
  finally { tickInFlight = false; }
}
pollTimer = setInterval(() => tick().catch(…), POLL_INTERVAL_MS);
```

### Context auto-injection (n=2: quarkus, idea)

Both extensions inject the pi working directory into MCP calls so the LLM never needs
to think about it — but they do it differently:

- **idea**: always merges `projectPath = ctx.cwd` into *every* tool call inside
  `execute()`, overriding whatever the LLM supplies.
- **quarkus**: injects `projectDir = cwd` explicitly in slash-command handlers but
  does NOT auto-inject it in the dynamically-registered MCP proxy tools. The LLM
  must supply `projectDir` when calling those tools directly.

The idea approach (always-inject in `execute`) is safer: the LLM cannot accidentally
omit or mis-specify the project path. Prefer it for any extension that wraps an
external server that requires a project scope.

### MCP client pattern (n=2: quarkus, idea)

Any extension that wraps an external MCP server needs an `McpClient`. Do not write one
from scratch — pick the right transport variant below and use the existing implementation
as your starting point.

**What is fixed (the JSON-RPC session layer — same in every client):**

```typescript
class McpClient {
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

  // 1. Send initialize request
  // 2. Send notifications/initialized (no response expected)
  // 3. Call tools/list to discover available tools
  private async _initialize(): Promise<void> { … }

  private request<T>(method: string, params?: unknown): Promise<T> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      this.pending.set(id, { resolve, reject });
      this.send({ jsonrpc: "2.0", id, method, params });
    });
  }

  // On each incoming line/message: look up pending by id, resolve or reject.
  // On close/error: reject all pending with a descriptive error, then invoke close listeners.

  async callTool(name: string, args: Record<string, unknown>): Promise<…> {
    await this.ready; // wait for _initialize() to complete
    return this.request("tools/call", { name, arguments: args });
  }

  async close(): Promise<void> {
    // reject remaining pending, then tear down the transport
  }
}
```

**What varies (the transport layer — pick one):**

| Transport | When to use | Reference |
|-----------|-------------|-------------------|
| **stdio** | Server is a local process you spawn (e.g. jbang, npx) | `extensions/quarkus/mcp-client.ts` |
| **SSE**   | Server is a local HTTP endpoint (e.g. IDE plugin, dev server) | `extensions/idea/mcp-client.ts` + `sse-transport.ts` + `jsonrpc.ts` |

**stdio specifics** (`quarkus`):
- `spawn(command, args, { stdio: ["pipe","pipe","pipe"] })` and `readline` over stdout.
- Messages are newline-delimited JSON; write to `proc.stdin`.
- The process may take tens of seconds to start — use the promise-coalescing pattern
  from the *Lazy MCP startup* section above.
- Register a `close` listener on the child process to detect crashes and reset state.

**SSE specifics** (`idea`):
- Connect to `<baseUrl>/sse`; the server pushes a `endpoint` event containing the
  POST URL for client-to-server messages.
- Send requests as HTTP POST; receive responses as SSE events on the same stream.
- Each tool call should carry a `timeoutMs` because HTTP requests can hang silently.
- The `projectPath` context injection (always overwrite with `ctx.cwd`) belongs in
  `callTool`, not at the transport level — see *Context auto-injection* above.

**Protocol constants to copy verbatim** (wrong values here cause silent failures):

```typescript
// initialize request
{ protocolVersion: "2024-11-05",  // or "2025-03-26" for newer servers
  capabilities: {},
  clientInfo: { name: "pi-<extension>", version: "0.1.0" } }

// after initialize response — send as notification (no id, no response expected)
{ jsonrpc: "2.0", method: "notifications/initialized" }

// tool discovery
request("tools/list", {})

// tool call
request("tools/call", { name, arguments: args })
```

## Still to be answered

- **Testing strategy:** what's worth a unit test vs. what requires the real pi runtime?
  (`idea` has a unit + e2e split; `maven` has unit tests only; `quarkus` has unit tests.
  No cross-cutting rule has emerged yet.)
- **Debug logging convention:** `idea` uses `IDEA_MCP_DEBUG_FILE=<path>` for opt-in
  append-only debug output. `pi`'s TUI swallows `console.error`, making file output the
  only user-visible diagnostic. If a second extension adopts the same env-var shape
  (`<EXTENSION>_DEBUG_FILE`), promote it here. Not promoted at n=1 because the naming
  convention encodes a deliberate choice, not a pi-API workaround.
