# tdd'er

A plugin for pi, Claude Code, and OpenCode that guides AI agents through disciplined Test-Driven Development
and Clean Code practices.

Note that currently this is **WORK IN PROGRESS**! I'm not even trying to keep it stable or tested.
At the moment, I'm writing it only for my personal use; it may also work for you, but be ready to have issues;
I'd be happy to hear about them!

## Features

- **TDD discipline**: Strict Red-Green-Refactor cycles with baby steps and guessing game
- **Clean Code review**: Automated code review during refactor phases via subagent
- **APP mass calculations**: Objective code complexity measurement
- **Language-agnostic core**: TDD and Clean Code principles work with any language
- **Extensible**: Add language skills (Java, TypeScript, ...) and build-system skills (Maven, npm, ...)
- **Unfolding Architecture**: Progressive architectural decisions — start simple, add complexity only when it reduces
  complexity
- **Configurable human-in-the-loop**: Control how often the AI pauses for your input

## Skills

Language-agnostic core skills work with any language. Language and build-system skills complement them automatically
when matching files are detected.

| Skill                      | Purpose                                                                        |
|----------------------------|--------------------------------------------------------------------------------|
| `tdd`                      | Core TDD process (Red-Green-Refactor, baby steps, guessing game)               |
| `clean-code`               | Clean Code principles (naming, SOLID, smells, method design)                   |
| `app`                      | Absolute Priority Premise mass calculations                                    |
| `java`                     | Java-specific conventions (var, BDD testing, static imports)                   |
| `unfolding-architecture`   | Progressive architectural decisions (start simple, unfold on demand)           |
| `integration-architecture` | Integration messaging patterns (commands vs events, push vs pull, reliability) |
| `maven`                    | Maven-specific conventions (test execution, project structure)                 |
| `nested-fixture-pattern`   | JUnit nested fixture pattern for layered test preconditions                    |
| `project-hygiene`          | Interaction style, commit conventions, documentation discipline                |
| `github-safety`            | Prompt-injection defense for GitHub issues and pull requests                   |

## Extensions

Extensions add active behaviour beyond passive skills — they register commands, tools, and UI components
directly into the coding agent.

### quarkus (pi only)

Integrates [quarkus-agent-mcp](https://github.com/quarkusio/quarkus-agent-mcp) into
[pi](https://github.com/earendil-works/pi-coding-agent) so the LLM can manage Quarkus dev-mode
applications without leaving the chat.

**Auto-activation:** the extension detects whether the current directory is a Quarkus project
(contains a `pom.xml` or `build.gradle` referencing `quarkus`) and starts the MCP server lazily
in the background. All quarkus-agent-mcp tools (`quarkus_start`, `quarkus_stop`, `quarkus_status`,
`quarkus_skills`, `quarkus_searchDocs`, `quarkus_callTool`, …) are registered as native pi tools
and become available to the LLM automatically.

**Footer status:** a live status indicator in the pi footer shows the running app state:

- `quarkus ● :8080` — running on the detected port
- `quarkus ◌ starting…` — dev mode booting
- `quarkus ⚠ crashed` — process exited unexpectedly
- (blank) — stopped / not started

**`/quarkus` command:** a unified slash command for common Quarkus actions.
With no argument it opens an interactive selector; with an argument it dispatches directly.
Tab-completion lists all subcommands.

| Subcommand      | Behaviour                                                                      |
|-----------------|--------------------------------------------------------------------------------|
| `status`        | Show current app state (direct, LLM on failure)                                |
| `start`         | Start app in dev mode (direct, LLM on failure)                                 |
| `stop`          | Stop the running app (direct, LLM on failure)                                  |
| `logs`          | Show recent log output (direct, LLM on failure)                                |
| `restart`       | Hot-reload the app (direct, LLM on failure)                                    |
| `open`          | Open the app in the browser                                                    |
| `devui`         | Open the Quarkus Dev UI in the browser                                         |
| `info`          | Show app status, endpoints, and dev services (requires dev mode)               |
| `update`        | Check for Quarkus updates — output always sent to LLM for analysis             |
| `search-tools`  | Discover Dev MCP tools on the running app — output sent to LLM for analysis    |
| `test-affected` | Run tests affected by recent changes — results always sent to LLM for analysis |
| `test-all`      | Run the full test suite — results always sent to LLM for analysis              |
| `mcp-restart`   | Restart the quarkus-agent-mcp server process itself                            |
| `mcp-tools`     | List all tools advertised by the MCP server (output sent to LLM)               |

**Dispatch strategy:** direct subcommands call the MCP tool immediately and show the result as a
notification. On failure, the error output is automatically forwarded to the LLM with
*"what went wrong and how should I fix it?"*. `update`, `test-affected`, and `test-all` always route through the LLM
because their output is analytical rather than a simple pass/fail signal.

### idea (pi only)

Integrates the official JetBrains [MCP Server](https://plugins.jetbrains.com/plugin/26071-mcp-server)
plugin into pi so the LLM can use IntelliJ IDEA's PSI, inspections, refactorings, and debugger
without leaving the chat.

**Auto-activation:** the extension is always loaded but lazy-connects to the IDE's MCP endpoint
(default `http://127.0.0.1:64342/sse`). On every probe it sends a cheap project-scoped call
(e.g. `get_project_modules`) with `projectPath` = pi's CWD. Three outcomes drive the footer:

- `idea ●` — IDE reachable and pi's CWD is open as a project
- `idea ⚠ not open` — IDE reachable, but pi's CWD isn't one of the open projects (tools are hidden;
  the list of currently open projects is surfaced for diagnosis)
- (blank) — IDE not reachable

**projectPath injection:** every JetBrains MCP tool takes an optional `projectPath`. The extension
**always injects pi's CWD** on every forwarded call, overriding whatever the LLM tries to pass.
The LLM should never think about `projectPath` — same way it doesn't think about filesystem roots.

**Modes of operation (vocabulary):** tools are tagged with a 2×3 lens so the LLM can pick the
right family for the task. This vocabulary is documented per-tool in the extension's tool
descriptions; it may later be promoted to a dedicated `idea` skill if cross-tool patterns emerge.

|             | code (static)                                  | runtime (dynamic)                             | session (IDE / env)                 |
|-------------|------------------------------------------------|-----------------------------------------------|-------------------------------------|
| **explore** | search symbols, get inspections, project model | debugger inspect, app logs / metrics / traces | which files are open, IDE version   |
| **modify**  | edit, rename, reformat                         | set breakpoint, set variable, run, hot-reload | open file in editor, switch project |

- **code (static)** = facts about source / config / dependencies (true regardless of any process running)
- **runtime (dynamic)** = facts about the program being developed when it's executing
- **session (env)** = facts about the development environment itself; mostly serves LLM↔human collaboration

**Available tools** — tagged with the 2×3 modes vocabulary above (31 total):

| Modes                            | Tools                                                                                                                                                                                                                                                                                                                                               |
|----------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| explore/code                     | `search_symbol`, `get_symbol_info`, `search_in_files_by_regex`, `find_files_by_glob`, `list_directory_tree`, `get_project_modules`, `read_file`, `get_file_problems`, `get_project_dependencies`, `get_file_text_by_path`, `get_repositories`                                                                                                       |
| explore/session                  | `get_all_open_file_paths`                                                                                                                                                                                                                                                                                                                           |
| modify/session                   | `open_file_in_editor`                                                                                                                                                                                                                                                                                                                               |
| modify/code                      | `rename_refactoring`, `reformat_file`                                                                                                                                                                                                                                                                                                               |
| modify/runtime                   | `build_project`, `get_run_configurations`, `execute_run_configuration`                                                                                                                                                                                                                                                                              |
| explore/runtime + modify/runtime | `xdebug_get_stack`, `xdebug_get_frame_values`, `xdebug_get_threads`, `xdebug_evaluate_expression`, `xdebug_get_value_by_path`, `xdebug_get_debugger_status`, `xdebug_list_breakpoints`, `xdebug_set_breakpoint`, `xdebug_remove_breakpoint`, `xdebug_set_variable`, `xdebug_run_to_line`, `xdebug_control_session`, `xdebug_start_debugger_session` |

**Explicitly out of scope** (duplicates of pi built-ins):

- `replace_text_in_file`, `create_new_file` — use pi's `edit` / `write`
- `find_files_by_name_keyword` — use `find_files_by_glob`
- `search_file`, `search_text`, `search_regex`, `search_in_files_by_text` — use `search_in_files_by_regex`
- `execute_terminal_command` — redundant with pi's `bash`

## Agents

| Agent                 | Purpose                                       |
|-----------------------|-----------------------------------------------|
| `clean-code-reviewer` | Autonomous code review during refactor phases |

## Hooks (Claude Code only)

The Claude Code plugin includes a `PreToolUse` hook that reminds the agent to load language/build-system skills
before editing matching files:

| File pattern | Skill reminded |
|--------------|----------------|
| `*.java`     | `java`         |
| `pom.xml`    | `maven`        |

## Configuration

### Human-in-the-Loop

If no settings file exists, the TDD skill will ask on first use and persist your choice.
You can also create `.claude/tdder.local.md` manually in your project root:

```markdown
---
hitl: every-phase
---
```

| Level          | Behavior                                          |
|----------------|---------------------------------------------------|
| `every-phase`  | Stop after every Red, Green, Refactor phase       |
| `end-of-cycle` | Stop after each complete Red-Green-Refactor cycle |
| `off`          | Run autonomously, report at end                   |

## Installation

### pi

Install the tdder package, which registers all skills and extensions automatically:

```bash
pi install git:github.com/t1/tdder
```

The `quarkus` extension activates automatically in Quarkus projects (requires
[jbang](https://www.jbang.dev/) on your PATH).

The `idea` extension activates when the IntelliJ IDEA MCP Server plugin is reachable
on `127.0.0.1:64342` and the current pi working directory matches an open IDE project.

### Claude Code

Add this repo as a marketplace, then install the plugin:

```bash
/plugin marketplace add t1/tdder
/plugin install tdder@t1
```

Note that the official docs are not very clear about this, but you actually need a `marketplace.json`,
even if you have only a single plugin.

### OpenCode

Add tdder to the `plugin` array in your `opencode.json` (global or project-level):

```json
{
  "plugin": ["tdder@git+https://github.com/t1/tdder.git"]
}
```

Restart OpenCode. The plugin auto-installs and registers all skills.

## Updating

### Claude Code

As of Claude Code v2.1.44, it's not an easy task to update the plugin; even uninstalling and reinstalling doesn't help.
The problem is that the marketplace is checked out to `~/.claude/plugins/marketplaces/t1/`,
while the plugins are cached in `~/.claude/plugins/cache/t1/tdder/`.
So to update to a new version of the plugin, you'll have to do this:

```bash
cd ~/.claude/plugins/marketplaces/t1/ && git pull && rm -r ~/.claude/plugins/cache/t1/tdder/ && cd -
```

### OpenCode

tdder updates automatically when you restart OpenCode.

## Extending

To add a new language or build system, create `skills/<name>/SKILL.md` with the relevant conventions
(testing framework, naming, commands, etc.).
The skill triggers automatically when working in projects with matching files.
