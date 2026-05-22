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
