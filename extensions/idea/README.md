# pi-idea

pi extension that bridges to the official JetBrains
[MCP Server](https://plugins.jetbrains.com/plugin/26071-mcp-server) plugin, so the LLM can
use IntelliJ IDEA's PSI, inspections, refactorings, and (eventually) debugger directly
from the chat.

**Status:** v0.1 in progress. See the parent repo's `README.md` for scope and roadmap,
and `AGENTS.md` in this directory for design decisions.

## Requirements

- IntelliJ IDEA (or any IDE that ships the JetBrains MCP Server plugin) running locally
- The MCP Server plugin enabled in the IDE (default endpoint: `http://127.0.0.1:64342/sse`)
- The project pi is working on must be open in the IDE

## Development

```bash
npm install
npm test         # run tests
npm run test:watch
```

Load locally for end-to-end testing:

```bash
pi --extension /path/to/tdder/extensions/idea
```

## Debug logging

The extension is silent by default. Set `IDEA_MCP_DEBUG_FILE` to a writable path to
append state-transition and timing information for debugging:

```bash
IDEA_MCP_DEBUG_FILE=/tmp/pi-idea.log pi --extension ./extensions/idea
tail -f /tmp/pi-idea.log     # in another terminal
```

If the path is unwritable, the extension prints one warning to stderr and stays silent
afterwards (pi's TUI may swallow stderr; capture with `pi ... 2>/tmp/pi.err` to see it).

Logs may contain filesystem paths (working directory, open IDEA project paths) and
error stack traces — review before sharing for support. The file is **append-only**;
the extension does **not** rotate or cap it. Manage size yourself, e.g.
`truncate -s 0 $IDEA_MCP_DEBUG_FILE` or via `logrotate`.

The debug log format is **unstable** and may change between versions without notice.
Don't write tooling that depends on specific fields.
