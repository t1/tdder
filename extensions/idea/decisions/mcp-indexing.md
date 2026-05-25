# MCP indexing behaviour

Read `extensions/idea/AGENTS.md` before this file.

## MCP behaviour during indexing: confirmed empirically

Probed with 10 000 synthetic Kotlin files dropped into an open project while polling
`search_symbol` and `get_file_problems` every 100 ms.

**Observed behavior:**

- **First call slips through** — returns immediately with a partial/wrong result (0 symbols)
  before IDEA's indexing lock is acquired.
- **Subsequent calls block** — held for the full duration of indexing (~11 s for 10 000 files);
  no response until the index is complete, then correct results.
- **`get_file_problems` is immune** — correct from tick zero throughout; it uses a code path
  that does not require the full project symbol index.
- **`get_project_dependencies` is immune to PSI indexing** — returned in 0.01 s with correct
  results when PSI indexing is in progress; reads from the project model, not the PSI index.
- **`get_project_dependencies` is NOT immune to Gradle/Maven sync** — returns stale results
  silently for the entire duration of a sync. On a brand-new project this means 0 (probed:
  ~2.5-min window); on an existing project after a build-file change it returns the previous
  sync's count, which is subtler and harder to detect. No error, no block, no signal. The
  retry logic does not help. LLM guidance is the only available mitigation. No MCP-level fix
  exists without a Gradle/Maven sync state signal from the plugin.

**Consequence for the extension:** no defensive machinery needed for the blocking case —
IDEA handles that itself. The only exposure is the one leaky first call that returns a
silently wrong result. In normal LLM usage (files created one at a time, no immediate
rapid-fire `search_symbol`) the window for that first call is negligible. Document, don't defend.

`rename_refactoring` was probed separately under the same 10 000-file load. Two distinct error
texts appear across successive retries:

1. `"MCP tool call has been cancelled likely by a user interaction: null"` — fast-cancel before
   the index lock is acquired (first call, ~0.4 s).
2. `"MCP tool call has been failed: Please change caller according to
   com.intellij.openapi.project.IndexNotReadyException documentation. Dumb mode start trace is
   in attachment."` — dumb-mode rejection after the lock is held (~1.4 s).

Both return `kind: "ok"` from the MCP, so they must be detected by text matching. After the
dumb-mode rejection clears, the rename succeeds on the next attempt (~2.7 s total, 3 attempts).

The root cause is a gap in the MCP plugin: it should wrap tool executions in
`DumbService#runReadActionInSmartMode(Computable)`, which blocks internally until indexing
finishes and then runs. Instead, it lets the exception escape. Our retry in `index.ts` is a
client-side workaround; the proper fix belongs in the JetBrains MCP plugin.
Filed as https://github.com/JetBrains/mcp-jetbrains/issues/87.

The extension handles this transparently: the `execute` path in `index.ts` retries on either
text until the ceiling (30 s, 1 s between attempts). The LLM never sees the intermediate errors.

**Consequence for Tier 3 tests:** committed fixture files are indexed at project-open time, so
no window exists by the time tests run. For ephemeral files created mid-test, the same retry
behaviour applies — no special test-side handling needed.
