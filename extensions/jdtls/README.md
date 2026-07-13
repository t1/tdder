# pi-jdtls

pi extension that spawns [Eclipse JDT Language Server](https://github.com/eclipse-jdtls/eclipse.jdt.ls)
and exposes its Java intelligence as native pi tools, so the LLM can query diagnostics,
search symbols, hover for type info, rename, and reformat without leaving the chat.

This is the alternative to `pi-idea` for when IntelliJ IDEA is not available or not running.

## Requirements

- jdtls installed locally — any of:
    - Homebrew: `brew install jdtls`
    - [Mason](https://github.com/williamboman/mason.nvim) (Neovim): `MasonInstall jdtls`
    - VS Code [Language Support for Java](https://marketplace.visualstudio.com/items?itemName=redhat.java) extension (
      bundles jdtls)
- Java 21+ on `PATH` (or `JAVA_HOME` set)

## Auto-activation

The extension detects whether the current directory is a Java project (contains a `pom.xml`,
`build.gradle`, or `build.gradle.kts`) and starts jdtls lazily in the background.

The enable choice is persisted to `.pi/settings/jdtls.json` and is **sticky in both directions**:

| `enabled` | behaviour on session start |
|-----------|----------------------------|
| absent    | ask once, persist the answer, start on yes |
| `true`    | start immediately, no prompt |
| `false`   | stay silent, do not start |

To flip a persisted choice, run `/jdtls ask` or delete `.pi/settings/jdtls.json`.

## `/jdtls` command

Manages the jdtls bridge manually. Subcommands:

| Subcommand | Action |
|------------|--------|
| `start`    | Start the language server (no-op if already running) |
| `stop`     | Stop the language server (no-op if not running) |
| `status`   | Report running / starting / stopped state |
| `ask`      | Re-prompt enable/disable and persist the answer — the escape hatch for a stuck preference |

## Tools

| Tool                    | Backed by                         |
|-------------------------|-----------------------------------|
| `get_file_problems`     | `textDocument/publishDiagnostics` |
| `search_symbol`         | `workspace/symbol`                |
| `get_symbol_info`       | `textDocument/hover`              |
| `rename_refactoring`    | `textDocument/rename`             |
| `reformat_file`         | `textDocument/formatting`         |
| `get_project_modules`   | `workspace/executeCommand` `java.project.listSourcePaths` |
| `code_action`           | `textDocument/codeAction`         |
| `read_file` (jar/class) | `java/classFileContents`          |

Tool **labels** are intentionally identical to `pi-idea` so the `java` and `maven` skills
work the same way regardless of which extension is active. The registered names carry a
`jdtls_` prefix (e.g. `jdtls_get_file_problems`) to avoid collisions if both extensions
are loaded simultaneously.

## Data directory and IDE sharing

jdtls stores its symbol index in a per-project cache directory. By default, the jdtls
launcher places this at:

- macOS: `~/Library/Caches/jdtls/jdtls-<hash>/`
- Linux: `~/.cache/jdtls/jdtls-<hash>/`

where `<hash>` is derived from the project directory name.

This extension uses the same default, so **the index is shared with any jdtls-based IDE
already running on the same project** (VS Code with the Java extension, Neovim with
nvim-jdtls, etc.). If the IDE has already indexed the project, pi inherits the warm cache
and skips the cold-start cost (~14 s on a small project, more on larger ones).

Note: jdtls also writes Eclipse project metadata (`.classpath`, `.project`, `.settings/`,
`.factorypath`) into the project root. These cannot be redirected. They are standard
Eclipse files and are typically already covered by `.gitignore` in Maven/Gradle projects.

## Footer status

| Indicator           | Meaning                      |
|---------------------|------------------------------|
| `jdtls ●`           | Running and ready            |
| `jdtls ◌ starting…` | Indexing in progress         |
| `jdtls ⚠`           | Crashed or unreachable       |
| (blank)             | Not a Java project / stopped |

## Development

Load locally for end-to-end testing:

```bash
pi --extension /path/to/tdder/extensions/jdtls
```
