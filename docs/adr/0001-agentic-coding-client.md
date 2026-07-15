# Agentic Coding Client Selection

## Status

Draft

## Context and Problem Statement

Agentic coding clients are rapidly evolving tools that can autonomously plan, write, edit, test,
and commit code on behalf of a developer. We need to choose a primary client (or a combination)
for our development workflow.

The market is moving fast. **All cells marked `[verify]` must be confirmed against current
documentation or release notes before this ADR is accepted.**

## Decision Drivers

* Ability to use our preferred LLM provider(s)
* Security: controlled, auditable file system and shell access
* Extensibility: custom tools, skills, and workflow patterns
* Quality of agentic loop (planning, self-correction, error recovery)
* TDD / structured workflow support
* Cost and licensing transparency
* UX fit for our team (TUI, IDE plugin, CLI, web)
* **Open standards**: portability of project instructions (AGENTS.md), reusable skills (SKILL.md), and interoperability across clients

## Considered Options

* Claude Code (Anthropic)
* pi (earendil-works)
* OpenCode
* Aider
* Cursor
* Cline (VS Code extension)
* Gemini CLI (Google)
* Amp (Sourcegraph)
* Windsurf / Devin Desktop (Cognition)
* Kiro (AWS)
* Codex CLI (OpenAI)
* Goose (AAIF / Linux Foundation)

## Decision Outcome

Chosen option: **[TBD]**, because …

### Consequences

* Good: …
* Bad: …

---

## Comparison

### 1. Core Capabilities

| Client | LLM support | Context / compaction | Agentic loop quality |
|--------|-------------|----------------------|----------------------|
| Claude Code | Anthropic-first (Fable, Opus, Sonnet, Haiku); also Amazon Bedrock, Google Vertex, Azure Foundry via env vars; BYOK via custom base URL | auto-compaction at context limit; manual `/compact`; re-injects CLAUDE.md post-compact | strong — plan mode, sub-agents (Explore, Plan, general), parallel background agents; no undo stack |
| pi | 30+ providers; OAuth subscriptions (Claude Pro/Max, ChatGPT Plus/Pro, GitHub Copilot); API key providers; custom endpoints (Ollama, llama.cpp, vLLM, …); mid-session model switch | auto-compaction on overflow; manual `/compact`; fully customizable via extensions | minimal by design — no built-in plan mode or sub-agents; both buildable via extensions; tree-structured session branching |
| OpenCode | 75+ providers (Anthropic, OpenAI, Google, Bedrock, Azure, Ollama, OpenRouter, local models, …) | context compaction via dedicated compaction agent | strong — plan/build agents, sub-agents, undo/redo |
| Aider | 100+ models via LiteLLM — OpenAI, Anthropic, Google, DeepSeek, Groq, Azure, Bedrock, Vertex, Ollama, LM Studio, any OpenAI-compatible API | repo map (tree-sitter, configurable token budget); prompt caching; no auto-summarization | architect+editor two-model loop; `/undo` reverts last commit; no multi-agent spawning |
| Cursor | Anthropic, OpenAI, Google, Moonshot, xAI, Z.ai; own Composer models; BYOK; Auto mode routes within first-party pool | semantic codebase index; Max Mode up to 1M token context; `preCompact` hook | plan mode (Shift+Tab); sub-agents; checkpoint-based undo/redo |
| Cline | 30+ providers, BYOK always free (pay provider directly); optional ClinePass $9.99/mo for managed open-weight models without provider setup (GLM, Kimi, DeepSeek, MiniMax, MiMo, Qwen); Plan/Act can use different models | per-task subagents (experimental, parallel, read-only); `.clineignore` | Plan mode (read-only) + Act mode; experimental parallel sub-agents; checkpoint undo via shadow git (per tool call) |
| Gemini CLI | Google Gemini models (Gemini 3.x series); open-source; model routing with fallback | JIT context files; token caching; `--map-tokens` equiv | plan mode (read-only); sub-agents (experimental); rewind/replay; checkpointing |
| Amp | Anthropic, OpenAI, Google, xAI, Meta, Bedrock, Fireworks; Amp-managed model per mode (low/medium/high/ultra); no user model selection by default | dedicated Compaction model (GPT-5.4); "Read Bigger Threads" feature | 4 modes; autonomous sub-agents (Oracle, Librarian, Painter); no undo stack |
| Windsurf / Devin Desktop | Anthropic, OpenAI, Google, Cognition SWE models, DeepSeek, Kimi, GLM; Adaptive router; `swe-1-6-fast` free | lazy rule/skill discovery; skills JIT-loaded | Cascade (chat-based); Devin CLI with plan mode + sub-agents; `/handoff` to Devin Cloud for full PR workflow |
| Kiro | Kiro-managed multi-model (OpenAI, Anthropic, DeepSeek, MiniMax, GLM, Qwen; Auto router); no BYOK | steering files with JIT `fileMatch`/`auto` modes; skill progressive disclosure; `PreCompact`/`PostCompact` hooks | spec-driven (requirements→design→tasks); parallel task wave execution; checkpoint/revert in supervised mode |
| Codex CLI | OpenAI-first (GPT-5.x series); ChatGPT plan auth or API key; Amazon Bedrock; reasoning effort configurable | `PreCompact`/`PostCompact` hooks; AGENTS.md size capped (32 KiB); prompt caching | plan mode (`chat` sandbox); sub-agents; git checkpoints; `codex resume` |
| Goose | 15+ providers, full BYOK; ACP providers (Codex, Claude, Amp, pi); local models (Ollama, LM Studio) | prompt caching (Claude); `.goosehints`; `gooseignore`; skill progressive disclosure | planning guide + sub-agents + custom agents; `GOOSE_MODE=chat` for read-only; no undo stack |

### 2. Tool / Action Set

| Client | File system | Shell / exec | Web / browser | MCP support | Language-server (LSP) |
|--------|-------------|--------------|---------------|-------------|----------------------|
| Claude Code | yes — read, write, edit, glob, grep; working-dir boundary enforced | yes — bash (PowerShell on Windows); read-only commands auto-approved | yes — webfetch (isolated context); Chrome browser automation via MCP | yes — stdio, HTTP, SSE, WebSocket; local + remote; acts as MCP server | no built-in LSP; IDE surfaces (VS Code, JetBrains) provide language services |
| pi | yes — read, write, edit, grep, find, ls (controllable via --tools) | yes — bash tool; `!command` shorthand; synchronous | no built-in; curl/bash usable; browser skills installable | no built-in (by design — context overhead); buildable via extension | no |
| OpenCode | yes — read, write, edit, glob, grep | yes — bash tool with permission model | yes — webfetch tool | yes — local and remote MCP | yes — configurable LSP servers (30+ languages) |
| Aider | yes — reads/writes files directly in working dir | yes — `/run`, `--lint-cmd`, `--test-cmd`; `/git` commands | images and URLs added to context; no autonomous browsing | no | no (uses tree-sitter for repo map, not LSP) |
| Cursor | yes — read, write, edit, glob; external-file protection | yes — shell command tool; sandboxed (macOS Seatbelt, Linux Landlock+seccomp) | yes — web search + browser control (screenshots, navigation, element interaction) | yes — stdio, SSE, Streamable HTTP; tools/prompts/resources/elicitation; Marketplace | yes — full VS Code LSP (inherited as VS Code fork) |
| Cline | yes — read_files, editor, apply_patch, search (ripgrep); `.clineignore` restricts | yes — bash; real-time output; long-running background processes | yes — fetch_web + browser tool (requires approval toggle) | yes — stdio + Streamable HTTP + SSE; per-server autoApprove | via IDE (VS Code/JetBrains existing LSP); SDK plugin example for TypeScript LSP |
| Gemini CLI | yes — full file read/write/edit | yes — shell commands (sandboxed) | yes — web search + fetch | yes | yes — ACP Agent Registry (JetBrains, Zed); VS Code companion extension |
| Amp | yes — read, write, edit, glob, grep; full filesystem via Orbs | yes — bash tool; Orb terminal (tmux-shared); `amp -x` non-interactive | yes — web search + page retrieval (Parallel.ai); localhost screenshot; `agent-browser` in Orbs | yes — stdio + HTTP/SSE; OAuth; workspace MCP trust required | no first-class LSP; relies on IDE sidecar |
| Windsurf / Devin Desktop | yes — read, write, edit, glob, grep; sandbox enforces paths | yes — shell; sandboxed (`--sandbox` on Linux/macOS) | yes — MCP-based (e.g. Brave Search); Devin Cloud has browser; local unclear | yes — stdio, Streamable HTTP, SSE; OAuth; GUI marketplace; 100-tool cap | yes — full VS Code LSP (Devin Desktop is VS Code-based); Pyright, rust-analyzer, clangd, gopls |
| Kiro | yes — read, write, create, delete, search; protected paths require approval | yes — shell; approval required for untrusted commands | yes — URL context fetch; Powers (Figma, Stripe, etc. via MCP) | yes — MCP + Powers (bundled MCP with context); elicitation; OAuth | yes — Code OSS (VS Code fork) inherits LSP; Open VSX extensions |
| Codex CLI | yes — read, write, edit (apply_patch); writable roots configurable | yes — bash; sandboxed; trusted command rules | yes — built-in web search (`--search`); browser tool; computer use | yes — `codex mcp`; local + remote; Secure MCP Tunnel | via IDE extensions (VS Code, Cursor, Windsurf) |
| Goose | yes — read, write, edit via developer extension | yes — shell via developer extension | yes — Computer Controller extension (browser automation); web search via Perplexity | yes — deep MCP; MCP Sampling; MCP Elicitation; MCP Roots; 70+ extensions | no built-in |

### 3. Security & Sandboxing

Sandboxing modes used in this table:

| Mode | Mechanism | Examples |
|------|-----------|---------|
| **Built-in OS** | Client ships its own kernel-enforced sandbox (Seatbelt, Landlock, bubblewrap, seccomp) | Cursor, Codex CLI, Gemini CLI, Windsurf |
| **Built-in VM / container** | Client spawns its own VM or cloud container | Claude Code `/sandbox`, Amp Orbs, Kiro cloud |
| **External OS** | Third-party tool wraps the client process with kernel enforcement (Landlock/Seatbelt); no daemon, no image | **nono** (nono.sh) — works with any terminal agent |
| **External VM / container** | User runs the client inside Docker, a VM, or a micro-VM extension | Gondolin (pi), Docker (pi/Aider), OpenShell (pi) |
| **None / process-level** | No OS or container boundary; client runs as the invoking user | pi (bare), Aider, Cline, Amp, OpenCode, Goose |

> **nono** (nono.sh) is a standalone sandbox CLI — Landlock on Linux/WSL2, Seatbelt on macOS — that wraps any terminal agent via `nono run --profile <name> -- <agent>`. The `~/.config/nono/packages/always-further/pi` package bundles a signed nono policy profile **and** a pi extension that teaches the LLM how to use nono's own tools (undo, audit trail, etc.) from within a session. nono is not pi-specific; profiles exist for Claude Code, OpenCode, Codex, Goose, Copilot CLI, and others.

| Client | Permission model | Sandbox mode | Sandbox detail | Approval flow |
|--------|-----------------|--------------|----------------|---------------|
| Claude Code | layered: allowlist/denylist rules in settings.json; managed org policies; per-mode (default/acceptEdits/auto/plan/bypassPermissions) | built-in OS + built-in VM/cloud | optional `/sandbox` (Seatbelt/Landlock + network isolation); cloud sessions in isolated VMs | interactive prompt (approve once or always); PermissionRequest hook; auto-continue timeout configurable |
| pi | none built-in ("YOLO by default"); permission-gate extension (`@gotgenes/pi-permission-system`); `pi-landstrip` (Linux Landlock as extension) | external OS **or** external VM/container (user's choice) | **nono**: Landlock/Seatbelt, zero-overhead, `~/.config/nono/packages/always-further/pi` adds pi extension; **Gondolin**: micro-VM, pi-documented, keeps auth on host; **Docker**: whole pi process in container, pi-documented; **OpenShell**: policy-controlled, Kubernetes-capable, pi-documented | none built-in; buildable via extension |
| OpenCode | granular per-tool / per-path rules (allow/ask/deny); auto mode available | none | relies on permission rules + `external_directory` guard | per-request prompt (once/always/reject); `--auto` flag for non-interactive |
| Aider | none — full filesystem access of running user; `--dry-run` for preview | external VM/container (user-managed) | Docker install documented; no built-in sandbox | change-level confirmation (show diff, Y/N); `--yes` skips all prompts |
| Cursor | Run Modes (Auto-review classifier, Allowlist, Run Everything); `permissions.json` plain-English rules; enterprise MCP allowlisting | built-in OS | macOS Seatbelt + Linux Landlock+seccomp; `sandbox.json` for network/path config | per-category (shell/MCP/fetch); `permissions.json` rules; hooks can force approval prompt |
| Cline | per-category toggles (read files / edit files / execute commands / browser / MCP); enterprise RBAC and model controls | none | local machine execution; Kanban uses per-card git worktrees | per-tool-call by default; Auto Approve per category; YOLO Mode (opt-in); enterprise can lock YOLO off |
| Gemini CLI | trusted-folder model; policy engine for fine-grained control | built-in OS | sandbox mode (filesystem + network isolation for tool exec) | approval prompts for shell commands; plan mode disables edits entirely |
| Amp | no built-in permission system; secret redaction (auto-detect AWS/GCP/GitHub/etc. tokens); plugin-based policy via `tool.call` event; SOC 2 Type II | built-in VM (Orbs only) | no local OS sandbox; Orbs = remote Debian VMs, VM-level isolation from local machine | off by default; `ctx.ui.confirm()` in plugins for custom approval dialogs |
| Windsurf / Devin Desktop | `Read`/`Write`/`Exec` permission scopes; `allow`/`ask`/`deny` per pattern; reads Claude Code format (`.claude/settings.json`); enterprise sandbox enforcement | built-in OS | `--sandbox` flag (Linux: bubblewrap+socat; macOS: Seatbelt; Windows: unsupported); fail-closed | `ask` permission level; hooks (`PermissionRequest` event); background sub-agents auto-deny unapproved tools |
| Kiro | autopilot (autonomous) vs supervised (diff review after each turn); protected paths configurable; trusted commands list; hooks can block (exit code 2) | built-in VM/cloud (web sessions only) | no OS sandbox locally; web sessions run in isolated cloud sandboxes | supervised mode: mandatory hunk-level diff review; protected-path writes always prompt; shell approval for untrusted commands |
| Codex CLI | sandbox modes (`read-only`/`workspace-write`/`danger-full-access`); approval policies (`untrusted`/`on-request`/`never`); AI reviewer agent; enterprise `requirements.toml` | built-in OS | macOS Seatbelt; Linux/WSL2 bubblewrap; Windows Sandbox / WSL2 | hunk-level or whole-turn approval; `PermissionRequest` hook; `auto_review` AI reviewer |
| Goose | prompt injection detection (ML-based); adversary mode (independent AI reviewer); extension allowlist; ACP permission modes (`auto`/`smart-approve`/`approve`/`chat`) | none native; inherits from ACP provider | macOS: optional Apple sandbox; Linux/Windows: none native; inherits sandbox when routing through Codex/Claude ACP | adversary mode watches tool calls; `approve` ACP mode prompts all; `.goosehints` for manual control |

### 4. Extensibility & Customization

| Client | Custom tools / extensions | Skills / prompt templates | Custom models (BYOM) | Hooks / lifecycle |
|--------|--------------------------|--------------------------|----------------------|-------------------|
| Claude Code | MCP servers (stdio/HTTP/SSE/WebSocket); plugins (bundle MCP+hooks+agents+skills); Agent SDK; `apiKeyHelper`; custom base URL | yes — SKILL.md (Agent Skills standard); project + user + managed scopes; dynamic context injection; path-scoped activation | yes — Bedrock, Vertex, Azure Foundry; custom base URL for any OpenAI-compatible gateway | yes — rich hook system: session, turn, tool, agent, context, file, MCP, display events; command/HTTP/MCP/LLM/agent handler types |
| pi | yes — first-class TypeScript extensions SDK; 50+ examples; custom tools, TUI components, slash commands; SDK for Node.js embedding; RPC mode | yes — SKILL.md (Agent Skills standard); `~/.pi/agent/skills/`, `.agents/skills/`; imports from `.claude/skills/`, `.codex/skills/` | yes — 30+ providers; custom OpenAI/Anthropic/Google-compatible endpoints | yes — via extension event system (`pi.on("event", handler)`); per-turn message injection, history filtering, RAG |
| OpenCode | yes — MCP servers (local/remote), custom tools SDK, plugins | yes — SKILL.md files (project and global) | yes — 75+ providers, custom provider config, local models | yes — hooks system, custom agents (JSON or Markdown), custom commands |
| Aider | minimal — Python scripting API (unsupported/unstable); `--lint-cmd`/`--test-cmd`; `--commit-prompt` | no SKILL.md; `CONVENTIONS.md` (any name) loaded via `--read`; community conventions repo | yes — any provider via LiteLLM; custom base URL | minimal — `--lint-cmd`/`--test-cmd` post-edit hooks; pre-commit hook integration (opt-in) |
| Cursor | VS Code extension API (full ecosystem); Extension API for MCP registration; Marketplace; Team Marketplace for org plugins | yes — SKILL.md (agentskills.io standard); `.agents/skills/`, `.cursor/skills/`, `~/.agents/skills/`, `~/.cursor/skills/`; also reads `.claude/skills/`, `.codex/skills/`; built-in skills for automations, review, PR babysitting, etc. | yes — BYOK via API pool; custom model routing via Auto mode | yes — rich hooks system: 20+ events (tool, shell, MCP, file, sub-agent, session, context); command or LLM-prompt handler types |
| Cline | yes — SDK plugins (TypeScript); custom tools via `createTool()`; MCP servers; 50+ plugin examples | yes — SKILL.md (first-class); `.cline/skills/`, `~/.cline/skills/`, `.claude/skills/` | yes — 30+ providers, full BYOK | yes — 14 hook stages via SDK plugins; blocking or async; configurable timeout/retries |
| Gemini CLI | yes — extensions (skills, MCP servers, custom tools); Extension SDK | yes — SKILL.md (Agent Skills standard, agentskills.io); `.gemini/skills/`, `.agents/skills/` | Gemini models (via Google); OpenAI-compatible via config [verify] | yes — hooks system (`hooks/`); pre/post tool execution |
| Amp | yes — TypeScript plugins (`.amp/plugins/`, `~/.config/amp/plugins/`); `amp.registerTool`, `amp.registerCommand`; skills-bundled MCP | yes — SKILL.md (agentskills.io); `.agents/skills/`, `.claude/skills/`; skills can bundle MCP servers | Amp-managed; Enterprise BYOK for some providers | yes — plugin events: `session.start`, `agent.start`, `agent.end`, `tool.call`, `tool.result`; `agent.end` can chain follow-up turns |
| Windsurf / Devin Desktop | MCP servers (GUI marketplace); VS Code extensions; language server marketplace; hooks; skills with `allowed-tools` | yes — SKILL.md (agentskills.io); `.agents/skills/`, `.devin/skills/`, `.windsurf/skills/`; explicitly cross-client compatible | Cognition-managed; enterprise BYOK unclear | yes — `hooks.v1.json`; events: `PreToolUse`, `PostToolUse`, `PermissionRequest`, `UserPromptSubmit`, `Stop`, `SessionStart`, `SessionEnd`; reads Claude Code hook format |
| Kiro | MCP servers + Powers (MCP bundled with knowledge); Open VSX extensions; hooks | yes — SKILL.md (agentskills.io); `.kiro/skills/`, `~/.kiro/skills/`; GitHub URL or local import | Kiro-managed; no BYOK | yes — hooks in `.kiro/hooks/`; `PreToolUse`/`PostTaskExec`/`UserPromptSubmit` blockable; `command` or `agent` handler |
| Codex CLI | MCP servers; plugins (distribute skills+connectors); hooks; Record & Replay (macOS) generates skills from demonstration | yes — SKILL.md (agentskills.io); `.agents/skills/` hierarchy; `$skill-creator` and `$skill-installer` built-in; Record & Replay auto-generates | OpenAI + Bedrock; reasoning effort configurable | yes — `hooks.json` / `config.toml`; `PreToolUse`, `PermissionRequest`, `PostToolUse`, `PreCompact`, `PostCompact`, `UserPromptSubmit`, `SessionStart`, `SubagentStart/Stop`, `Stop`; trust model with hash verification |
| Goose | MCP extensions (70+); plugins (bundle skills+hooks); Recipes (portable YAML workflows); custom distributions; MCP Apps (interactive UI) | yes — SKILL.md (agentskills.io); `.agents/skills/`, `~/.agents/skills/`; reads `.claude/skills/`; community skills marketplace | yes — 30+ providers, full BYOK; ACP providers (route through Claude/Codex/Amp/pi) | yes — Open Plugins hooks spec; shell script handlers; 11 events including `BeforeShellExecution`, `BeforeReadFile`, `AfterFileEdit` |

### 5. Workflow & Integration

| Client | TDD / workflow patterns | Task delegation / orchestration | Git awareness | CI/CD integration |
|--------|------------------------|--------------------------------|---------------|-------------------|
| Claude Code | yes — Skills encode repeatable workflows; built-in `/debug`, `/code-review`, `/loop`, `/verify`; path-scoped skills per file type | yes — multi-agent orchestration; parallel background agents; custom sub-agents in Markdown; Agent SDK | yes — commit, branch, PR; `git status` auto-approved; worktree isolation for sub-agents | yes — `anthropics/claude-code-action@v1`; `@claude` trigger on PR/issue; Bedrock/Vertex/Azure support; GitLab CI also documented |
| pi | no built-in; user-defined via skills and extensions; `/plan` extension example available | no built-in; spawning pi via bash or tmux; sub-agent extension example exists | no built-in git tools; all via bash; git-checkpointing extension example | no built-in; scriptable via print/JSON/RPC modes |
| OpenCode | yes — skill system supports TDD, clean-code, etc. | yes — built-in sub-agents (explore, general, scout); custom sub-agents | yes — git-aware (undo/redo, AGENTS.md); GitHub Actions integration | yes — GitHub Actions (`/oc` trigger on issues/PRs); GitLab integration |
| Aider | yes — auto lint+test loop; `--test-cmd --auto-test` runs tests after each edit and auto-fixes failures; architect/editor mode for plan-then-build | no multi-agent; single sequential model (or architect+editor pair) | deep — auto-commits every change; `/undo` reverts; `/diff`; `Co-authored-by` attribution; no PR creation | no native CI/CD; scriptable via `--message --yes` flags |
| Cursor | no explicit TDD mode; Plan Mode + checkpoints + hooks support disciplined iteration | yes — cloud agents spawn typed sub-agents; multi-repo PR creation | yes — cloud agents clone, branch, commit, open PRs; BugBot for automated PR review | yes — cloud agent automations; `@cursor` on GitHub/GitLab/Bitbucket/Linear PR/issue |
| Cline | Plan/Act mode maps to think-then-build; checkpoints enable safe test-fail-fix cycles; Skills support custom TDD workflows | yes — multi-agent teams (SDK); Kanban parallel task cards with dependency chains | via bash; Kanban uses per-card git worktrees + auto-commit; `cline schedule` for cron tasks | yes — headless CLI (`cline --json`); GitHub Actions samples; Slack/Telegram/Discord connectors |
| Gemini CLI | plan mode for safe pre-implementation analysis; `/todo` task management | yes — sub-agents (experimental); remote sub-agents | yes — git-aware | yes — headless mode; GitHub Actions compatible |
| Amp | plugin `agent.end` follow-up chaining; Checks system (`.agents/checks/`) for automated quality gates; skills for workflow encoding | yes — autonomous sub-agents (Oracle, Librarian, Painter); custom modes via plugins | deep — `amp review` vs `git diff`; Librarian for GitHub search; Orbs have `gh` CLI | `amp -ox` non-interactive; remote control API; no native GitHub Action |
| Windsurf / Devin Desktop | `.windsurf/workflows/` markdown files (Cascade `/<name>` slash command); skills for CLI; hooks enforce policies | yes — foreground/background sub-agents; custom profiles; `/handoff` to Devin Cloud for PR-aware workflow | Devin Cloud: PR creation/CI monitoring; Devin Desktop: PR status in Kanban; `gh pr checkout` via shell | Devin API `POST /pr-reviews`; scheduled sessions; `/handoff` to cloud for CI-integrated PRs |
| Kiro | spec-driven as primary pattern (requirements→design→tasks); property-based correctness testing from requirements | yes — parallel wave task execution; dependency graph; web session autonomous mode | git-aware; web sessions connect to GitHub/GitLab; cross-repo changes; git checkpoints/revert | headless `kiro-cli`; cloud automations (web); GitHub/GitLab integration; no native GitHub Action documented |
| Codex CLI | `/review`; GitHub PR review via `@codex`; scheduled automations; git worktrees for parallel tracks | yes — sub-agents (`SubagentStart`/`SubagentStop` hooks); `codex --cd` delegation; worktrees | yes — GitHub integration: issue delegation, PR review; `task handoff` between local and cloud | yes — `codex github-action`; `codex exec` for scripting; Slack and Linear cloud integrations |
| Goose | RPI (Research→Plan→Implement) pattern; Recipes for repeatable workflows; sub-agents for parallel tasks | yes — sub-agents + custom agents; Recipes; ACP providers as backend | git-aware; GitHub MCP extension; `goose run` for non-interactive | `goose run` for CI; `goose serve` (ACP server) for embedding; no dedicated GitHub Action |

### 6. UX & Interface

| Client | Interface mode | Session management | Multi-file visibility | Speed feel |
|--------|---------------|-------------------|-----------------------|------------|
| Claude Code | terminal TUI, VS Code extension, JetBrains plugin, desktop app (macOS/Windows), web (`claude.ai/code`), iOS; Slack integration | persistent resumable sessions; background agents; Remote Control (phone→local); teleport between surfaces; scheduled routines | full repo via glob/grep/read; IDE surfaces provide file tree | fast; auto-updating; background processing |
| pi | TUI (scrollback-buffer-based, not full-viewport); print/JSON/RPC modes; Node.js SDK | tree-structured sessions (branch/fork/clone); continue (`-c`), resume (`-r`), ephemeral; export to HTML/GitHub gist | file tree + grep + LSP (via bash/tools) | fast; minimal overhead; ~243 releases in active use |
| OpenCode | TUI (terminal), web UI, IDE extension, desktop app | yes — named sessions, session sharing via URL, undo/redo per session | file tree + grep + LSP diagnostics | [verify] |
| Aider | CLI interactive REPL; `--browser` for web UI; watch mode for any IDE; voice input | per-directory sessions saved to `.aider.chat.history.md`; no named sessions; share via public URL renderer | repo map (tree-sitter); explicit file add/remove | fast; token counts shown inline |
| Cursor | IDE (VS Code fork) — desktop macOS/Windows/Linux; CLI (`cursor-agent`); web (`cursor.com/agents`); iOS app; Slack/GitHub triggers | checkpoints (auto-snapshots, restorable); Side Chats (multiple concurrent, v3.11); cloud agent session artifacts preserved | full IDE; semantic codebase index | fast; weekly releases; auto-update |
| Cline | VS Code extension; JetBrains plugin; CLI (TUI + headless); Kanban web board; SDK; works in Cursor/Windsurf/Zed | per-editor session history; multi-agent team state persistent; Kanban cards as persistent task units | full IDE visibility; ripgrep search across workspace | fast; 313 releases, active |
| Gemini CLI | CLI; IDE integration (Zed, JetBrains, Neovim, Vim via ACP/adapters) | rewind/replay sessions; checkpointing; `/memory show` | file tree + JIT context files | fast; Google-backed infrastructure |
| Amp | TUI (CLI); web UI (ampcode.com, thread/orb management, mobile); IDE sidecar (VS Code, JetBrains, Neovim, Zed via `amp --jetbrains` or `ide connect`) | Threads (server-side, persistent, shareable, archivable); multiple threads in one TUI; message queueing | full workspace + Orb filesystem; Librarian for cross-repo GitHub search | fast; frequent releases; Orb auto-pause |
| Windsurf / Devin Desktop | full IDE (VS Code-based, macOS/Windows/Linux); Devin CLI (TUI); ACP in JetBrains/Zed/Xcode; web (`app.devin.ai`); JetBrains plugin (separate) | Spaces (shared context + worktrees); Kanban board for multi-session; subagent panel; OTA updates | full IDE; VS Code LSP; semantic search | fast; OTA; "Next" prerelease channel |
| Kiro | IDE (Code OSS-based, macOS/Windows/Linux); CLI (`kiro-cli`); web (`app.kiro.dev`, cloud sandboxes, autonomous mode); ACP (JetBrains, Zed) | sessions at `~/.kiro/sessions/`; compaction; learnings carry across surfaces | full IDE; steering files; Powers context | fast; AWS-backed; frequent model additions |
| Codex CLI | CLI (TUI + `codex exec` non-interactive); desktop app (ChatGPT); web (`chatgpt.com/codex`); IDE extensions (VS Code, Cursor, Windsurf); mobile (iOS remote control) | `codex resume`; session fork; `task handoff` local↔cloud; Chronicle (session history, Pro) | repo map; AGENTS.md hierarchy; IDE context | fast; 915 releases; Rust core; auto-updating |
| Goose | desktop app (macOS/Linux/Windows native Rust); CLI (`goose session`, `goose run`); ACP server (`goose serve`) — usable in Zed/JetBrains; terminal integration; remote server mode | local session JSONL; `goose session resume`; Projects tab; no cloud session persistence | file tree + developer extension; 70+ MCP extensions | fast; open-source; community-driven |

### 7. Cost & Licensing

| Client | Pricing model | BYOK support | Usage visibility |
|--------|---------------|--------------|-----------------|
| Claude Code | subscription (Pro $20/mo, Max $100/mo, Team $20–100/seat); API PAYG; Bedrock/Vertex/Azure PAYG | yes — own API key or enterprise cloud provider billing | usage dashboard; shared pool with claude.ai chat; no per-request cost breakdown in TUI |
| pi | free (MIT open source); user pays LLM provider directly; optional Claude Pro/Max/ChatGPT/Copilot subscriptions | yes | token + cost in TUI footer per session; best-effort on aborted requests; `/session` for full cost |
| OpenCode | open-source (MIT); optional OpenCode Zen/Go managed plans | yes — BYOK via any supported provider | yes — usage tied to provider billing; no hidden markup when using BYOK |
| Aider | free (Apache 2.0); user pays LLM provider; free tier via OpenRouter or Gemini experimental | yes | `/tokens` in-chat command shows session token usage; no cost display |
| Cursor | Hobby free; Pro $20/mo; Pro+ $60/mo; Ultra $200/mo; Teams $40–120/seat; Enterprise custom; BYOK at API rates + $0.25/M Cursor Token Rate on non-Auto third-party | yes | usage dashboard (`cursor.com/dashboard`); both pools visible; enterprise AI code tracking API |
| Cline | free (Apache 2.0); BYOK always free — pay only your LLM provider directly; optional ClinePass $9.99/mo (first month $4.99 promo) for managed open-weight models without provider setup (GLM, Kimi, DeepSeek, MiniMax, MiMo, Qwen); Enterprise custom | yes | per-task tokens + cost in chat UI; enterprise OpenTelemetry export; per-team cost breakdown |
| Gemini CLI | free (Apache 2.0); Gemini API free tier (Gemini 2.5 Pro experimental); PAYG at Google AI rates | yes — own Google API key | usage via Google AI Studio dashboard; token counts in session footer |
| Amp | pay-as-you-go (no markup on model costs); Orbs billed separately per-minute for VM time ($0.10–$1.66/hr); Enterprise custom | Enterprise BYOK for some providers; individual: Amp-managed | thread-level usage in web UI; enterprise analytics API; audit logs |
| Windsurf / Devin Desktop | Free (SWE-1.6 Fast unlimited); Pro $20/mo; Max $200/mo; Teams $80/mo base + $40/seat; Enterprise custom | unclear for IDE/CLI; enterprise via Devin API | analytics dashboard (autocomplete, Cascade, ACU); Devin API v3 consumption endpoints |
| Kiro | Free (50 credits/mo); Pro $20/mo (1,000 credits); Pro+ $40/mo (2,000 credits); Pro Max $100/mo (5,000 credits); Power $200/mo (10,000 credits); add-on $0.04/credit | no BYOK | credit usage dashboard (updated every 5 min); enterprise admin console; per-model credit multipliers |
| Codex CLI | CLI: Apache-2.0 free; service via ChatGPT plan (Free/Go $8/Plus $20/Pro $100/Business $20-seat/Enterprise); API key at standard rates | yes — API key; Amazon Bedrock | `/status` shows context; ChatGPT usage dashboard; enterprise analytics + audit logs |
| Goose | free (Apache 2.0); user pays LLM provider directly | yes — full BYOK; 30+ providers | managed via LLM provider dashboard; no built-in cost display |

### 8. Ecosystem & Community

| Client | Open source | Plugin marketplace | Community / docs | Update cadence |
|--------|------------|-------------------|-----------------|----------------|
| Claude Code | no (CLI binary proprietary); claude-code-action and example repos public; MCP + Agent Skills are open standards | plugins via Claude Code marketplace; MCP registry | extensive docs at code.claude.com; Discord; large user base | very active (multiple releases/week; auto-updating; two channels: latest/stable) |
| pi | yes (MIT); `github.com/earendil-works/pi`; 70.9k stars | no marketplace; 50+ extension examples in repo; `badlogic/pi-skills` skills repo | GitHub discussions; blog posts by creator | very active (243 releases; latest v0.80.x Jul 2026) |
| OpenCode | yes (MIT) | plugin ecosystem; MCP marketplace | active Discord + GitHub; docs at opencode.ai/docs | very active (multiple releases/week as of Jul 2026) |
| Aider | yes (Apache 2.0); `github.com/Aider-AI/aider`; ~44k stars | no marketplace; community `Aider-AI/conventions` repo | Discord; leaderboards at aider.chat | active; no fixed schedule; frequent releases |
| Cursor | no (proprietary VS Code fork) | Cursor Marketplace; `cursor.directory`; Team Marketplace for org-internal | docs at docs.cursor.com; active Discord; large user base | active (weekly–biweekly minor releases; auto-updating) |
| Cline | yes (Apache 2.0); `github.com/cline/cline`; 64.6k stars; JetBrains plugin not open source | no dedicated marketplace; npm-based plugin install; MCP servers | docs.cline.bot; Discord; active GitHub | very active (313 releases; CLI v3.0.40 Jul 2026) |
| Gemini CLI | yes (Apache 2.0); `github.com/google-gemini/gemini-cli`; 106k stars | extensions ecosystem; agentskills.io skills | Google AI docs; GitHub discussions | active (Google-backed; frequent releases) |
| Amp | no (proprietary); Sourcegraph-backed | `@amp/` plugin packages; Amp Insiders; community thread sharing | X @ampcode; YouTube; Raising an Agent podcast | active (weekly+ announcements; `amp update`) |
| Windsurf / Devin Desktop | no (proprietary); Cognition-backed | MCP marketplace (GUI in IDE); integrations marketplace (Slack, Linear, Figma, Notion, etc.) | Discord; X @cognition; docs.devin.ai | active (OTA updates; "Next" prerelease channel) |
| Kiro | no (proprietary); AWS-backed | Powers marketplace (Figma, Terraform, Stripe, Firebase, etc.); Open VSX extensions | Discord; LinkedIn; YouTube; Twitch; `github.com/kirodotdev/Kiro` issue tracker; ambassador program | active (multiple model additions per month; ~1 year old) |
| Codex CLI | CLI: Apache-2.0 (`github.com/openai/codex`; ~98k stars, 14.6k forks) | plugin marketplace; `github.com/openai/skills` reference repo; Codex Ambassadors | Discord; Reddit; X @OpenAIDevs; developer forum; Codex for Students/Open Source fund | extremely active (915 releases; Rust core; multiple per week) |
| Goose | yes (Apache 2.0); `github.com/aaif-goose/goose`; 51.2k stars; AAIF/Linux Foundation governance; 500+ contributors | extensions marketplace (70+ MCP); skills marketplace at goose-docs.ai | Discord; YouTube; LinkedIn; X; BlueSky; Nostr | very active; community-governed; continuous releases |

### 9. Open Standards & Portability

How well a client supports vendor-neutral, file-based conventions that can be committed to the repo and reused across clients.

The key standards relevant to this decision:

| Standard | Governed by | What it covers |
|----------|-------------|----------------|
| **AGENTS.md** | Informal cross-client convention (originated with OpenAI Codex) | Project-level instruction files committed to the repo |
| **Agent Skills / SKILL.md** | [agentskills.io](https://agentskills.io) — open standard, originated at Anthropic | Portable, on-demand skill packages (`SKILL.md` + assets); 40+ clients |
| **MCP** (Model Context Protocol) | Anthropic / open | Standard protocol for tool/resource/prompt servers; widely adopted |
| **ACP** (Agent Client Protocol) | Open standard | Standard for embedding an agent inside an editor over JSON-RPC; supported by Zed, JetBrains, Neovim, etc. |
| **LSP** (Language Server Protocol) | Microsoft / open | Standard for language diagnostics and code intelligence |
| **.well-known/opencode** | OpenCode | Enterprise config distribution endpoint (not cross-client) |

> **Nested / JIT context files**: does the client automatically load a folder-local instruction file when the LLM *accesses a file in that subfolder* — without requiring it to be listed globally upfront?

| Client | Instruction file | Nested / JIT loading | Agent Skills (SKILL.md) | MCP | ACP | LSP |
|--------|-----------------|----------------------|-------------------------|-----|-----|-----|
| Claude Code | `CLAUDE.md` (does **not** read `AGENTS.md` natively — use `@AGENTS.md` import or symlink); walks up from CWD at start; `CLAUDE.local.md` for personal rules; managed/user/project scopes | **yes** — subdirectory `CLAUDE.md` files load JIT when Claude reads files in that directory | yes — native origin of standard; `~/.claude/skills/`; path-scoped activation; dynamic context injection | yes — stdio, HTTP, SSE, WebSocket; acts as MCP server | no | no built-in; IDE extensions provide language services |
| pi | `AGENTS.md` (also `CLAUDE.md`); walks up from CWD; global `~/.pi/agent/AGENTS.md`; `SYSTEM.md` / `APPEND_SYSTEM.md` | **no** — all files loaded at session start; no JIT per-directory loading documented | yes — SKILL.md (Agent Skills standard); `~/.pi/agent/skills/`, `.agents/skills/`; imports from `.claude/skills/`, `.codex/skills/` | no (by design); buildable via extension | no | no |
| OpenCode | `AGENTS.md` (falls back to `CLAUDE.md`) | **no** — no JIT loading; workaround: glob patterns in `instructions` config, loaded at session start | yes — SKILL.md; reads `.claude/skills/`, `.agents/skills/` | yes — local + remote | yes — `opencode acp` | yes — 30+ languages |
| Aider | none — no auto-discovered root instruction file; `CONVENTIONS.md` (any name) via `--read` or config; `.aiderignore` for exclusions | n/a | no | no | no | no (tree-sitter repo map only) |
| Cursor | `.cursor/rules/*.mdc` (path-scoped via `globs`); `AGENTS.md` at project root/subdirs; User Rules (global); Team Rules (enterprise) | **partial** — `.cursor/rules/` uses static glob patterns (not file-access-triggered); nested `AGENTS.md` in subdirs apply to work in that subtree | yes — SKILL.md (agentskills.io standard); `.agents/skills/`, `.cursor/skills/`, `~/.agents/skills/`, `~/.cursor/skills/`; also reads `.claude/skills/`, `.codex/skills/`; built-in skills for automations, review, etc. | yes — comprehensive; Marketplace | no | yes — full VS Code LSP |
| Cline | `.clinerules/` (primary); `AGENTS.md`; `~/.agents/AGENTS.md`; auto-detects `.cursorrules`, `.windsurfrules`; conditional path-glob rules | **partial** — path-glob scoping on `.clinerules/` files; no file-access-triggered loading | yes — SKILL.md first-class; `.cline/skills/`, `~/.cline/skills/`, `.claude/skills/` | yes — stdio + HTTP/SSE | yes — ACP mode (Neovim); hub-spoke SDK | via IDE |
| Gemini CLI | `GEMINI.md` (configurable; can include `AGENTS.md`); global `~/.gemini/GEMINI.md` | **yes** — true JIT loading: scans for `GEMINI.md` in accessed directory and ancestors at tool-call time | yes — SKILL.md; `.agents/skills/` alias; listed on agentskills.io | yes | yes — ACP Agent Registry; JetBrains, Zed | yes — VS Code companion extension; JetBrains/Zed via ACP |
| Amp | `AGENTS.md` (+ `AGENT.md`, `CLAUDE.md` fallbacks); global `~/.config/amp/AGENTS.md`, `~/.config/AGENTS.md`; system-wide `/etc/ampcode/AGENTS.md`; glob-activated included files (YAML frontmatter `globs:`) | **yes** — subtree `AGENTS.md` loaded lazily when agent accesses files in that subtree; glob-activated files injected JIT | yes — SKILL.md (agentskills.io); `.agents/skills/`, `.claude/skills/`, `~/.config/amp/skills/`; skills can bundle MCP | yes — stdio + HTTP/SSE; OAuth; workspace trust | no | no first-class LSP |
| Windsurf / Devin Desktop | `AGENTS.md` (+ `AGENT.md`, `.windsurfrules`, `CLAUDE.md` all treated equally); `AGENTS.local.md` gitignored; `.windsurf/rules/*.md` with trigger frontmatter; `.cursor/rules/*.mdc` read too | **yes** — subdirectory `AGENTS.md` discovered lazily when agent accesses files in that directory | yes — SKILL.md (agentskills.io); `.agents/skills/`, `.devin/skills/`, `.windsurf/skills/`; explicitly cross-client | yes — stdio, Streamable HTTP, SSE; OAuth; admin whitelist | yes — JetBrains, Zed, Xcode via ACP | yes — full VS Code LSP |
| Kiro | `AGENTS.md` (always-on); steering files `.kiro/steering/*.md` (`always`/`fileMatch`/`auto`/`manual` modes); foundational auto-generated files (`product.md`, `tech.md`, `structure.md`) | **partial** — `fileMatch` steering files load when matching files are in context; not file-access-triggered per-directory scan | yes — SKILL.md (agentskills.io); `.kiro/skills/`, `~/.kiro/skills/` | yes — MCP + Powers | yes — `kiro-cli acp`; JetBrains, Zed | yes — Code OSS (VS Code fork) |
| Codex CLI | `AGENTS.md` (walks from git root to CWD; `AGENTS.override.md` takes precedence; 32 KiB cap); global `~/.codex/AGENTS.md`; custom fallback filenames configurable | **yes** — walks root-to-CWD directory chain; each level checked; nested override files take precedence | yes — SKILL.md (agentskills.io); `.agents/skills/` hierarchy; Record & Replay auto-generates skills | yes — local + remote; Secure MCP Tunnel | via `codex-acp` adapter | via IDE extensions |
| Goose | `.goosehints` (primary instruction file); skills SKILL.md; backward compat: `.goose/skills/`, `.claude/skills/` | **partial** — `.goosehints` at project level; no documented hierarchical AGENTS.md chain | yes — SKILL.md (agentskills.io); `.agents/skills/`, `~/.agents/skills/`; community skills marketplace | yes — deep MCP; MCP Sampling + Elicitation + Roots + Apps | yes — both ACP server (`goose serve`) and ACP consumer (routes through Claude/Codex/Amp/pi) | no built-in |

---

## Pros and Cons of the Options

### Claude Code

* Good: strongest agentic loop — plan mode, parallel sub-agents, Agent SDK, rich hook system
* Good: Agent Skills (SKILL.md) — native origin of the standard; most complete implementation (path-scoped, dynamic injection, post-compact reload)
* Good: JIT nested CLAUDE.md loading — subdirectory rules load automatically when files in that directory are accessed
* Good: multi-surface — terminal, VS Code, JetBrains, desktop app, web, iOS, Slack
* Good: optional OS-level sandbox (`/sandbox`) + cloud sessions in isolated VMs
* Good: GitLab and GitHub Actions CI/CD integration
* Good: enterprise-grade — managed policies, MDM deployment, SOC 2, org-wide skill/MCP distribution
* Bad: proprietary CLI — no open-source code; locked to Anthropic models primarily (Bedrock/Vertex as secondary)
* Bad: BYOK via third-party providers (Bedrock, Vertex, Azure) requires env-var setup; not as seamless as pure BYOK tools
* Bad: subscription required for full access; free tier very limited
* Bad: does not read `AGENTS.md` natively — requires a `@AGENTS.md` import in `CLAUDE.md` (or a symlink) for cross-client instruction portability

### pi

* Good: minimal and fast — no built-in overhead; extensions add only what you need
* Good: first-class TypeScript extensions SDK — 50+ bundled examples; replace built-in tools, build custom TUI components; 5,296+ packages on pi.dev/packages
* Good: tree-structured sessions with branching, forking, cloning — best-in-class session management
* Good: SKILL.md support (Agent Skills standard); imports from `.claude/skills/`, `.codex/skills/`
* Good: reads `AGENTS.md` (and `CLAUDE.md`); `SYSTEM.md`/`APPEND_SYSTEM.md` for system prompt control
* Good: 30+ providers with mid-session model switching and cross-provider context handoff
* Good: fully open source (MIT); 70.9k stars
* Good: token + cost display in TUI footer per session
* Good: **with extensions**: sub-agents (`pi-subagents`, `pi-crew`, `@quintinshaw/pi-dynamic-workflows`), MCP (`pi-mcp-adapter`), LSP (`pi-lens`), web/browser (`pi-web-access`, `pi-lean-portal`), Linux Landlock sandboxing (`pi-landstrip`), permission gates (`@gotgenes/pi-permission-system`), plan mode (`pi-soly`, `gentle-pi`), git checkpoints (`@ayulab/pi-rewind`), memory (`pi-hermes-memory`)
* Good: **sandboxing options (all external to pi core)**: **nono** (external OS sandbox — Landlock/Seatbelt, zero-overhead, signed profiles; `~/.config/nono/packages/always-further/pi` bundles a policy profile + a pi extension that teaches the LLM to use nono's undo/audit tools; works with any terminal agent); **Gondolin** (external micro-VM, pi-documented, routes built-in tools into VM, keeps auth on host); **Docker** (external container, whole pi process, pi-documented); **OpenShell** (external policy sandbox, Kubernetes-capable, pi-documented); **pi-landstrip** (Linux Landlock as a pi extension, no nono required)
* Bad: no built-in permission model, plan mode, sub-agents, undo, or git tools — all require extensions or external tooling
* Bad: no built-in MCP (by design); no built-in web/browser tools
* Bad: no built-in OS sandboxing — YOLO by default; sandboxing requires external setup (Gondolin, Docker, OpenShell)
* Bad: no JIT nested AGENTS.md loading — all files loaded at session start
* Bad: extension quality varies widely across 5,296+ community packages; no vetting beyond npm

### OpenCode

* Good: open-source (MIT), no vendor lock-in on tooling
* Good: 75+ LLM providers including local models — maximum BYOK flexibility
* Good: skill system (SKILL.md) enables reusable workflow patterns (TDD, clean-code, etc.)
* Good: SKILL.md compatible with `.claude/skills/` and `.agents/skills/` conventions — portable across clients
* Good: reads AGENTS.md and CLAUDE.md — aligns with emerging cross-client standard
* Good: strong extensibility — MCP servers, custom tools SDK, plugins, custom agents
* Good: multi-interface — TUI, web, IDE extension, desktop app
* Good: built-in sub-agent orchestration (explore, general, scout) for parallel task delegation
* Good: GitHub Actions and GitLab integration for CI/CD workflows
* Good: LSP integration for 30+ languages (diagnostics as agent feedback)
* Good: granular permission model (per-tool, per-path, allow/ask/deny)
* Good: session sharing and undo/redo support
* Bad: no OS-level sandboxing — relies on permission rules and the `external_directory` guard; no container or kernel-level isolation
* Bad: no automatic per-folder AGENTS.md loading — nested rules must be listed upfront via glob in `opencode.json`; they are loaded at session start, not lazily when files in that folder are touched
* Bad: rapid release cadence means docs/features can be in flux
* Bad: TUI requires a modern terminal emulator (WezTerm, Kitty, Ghostty, Alacritty)

### Aider

* Good: open-source (Apache 2.0), battle-tested, ~44k stars
* Good: deepest git integration — auto-commits every change, `/undo` reverts, dirty-state protection
* Good: 100+ models via LiteLLM; widest provider coverage including free tiers (OpenRouter, Gemini)
* Good: architect+editor two-model mode — plan with one model, apply with another
* Good: auto lint+test loop — runs your test suite after each edit and auto-fixes failures (TDD-friendly)
* Good: repo map (tree-sitter) gives LLM codebase awareness without loading all files
* Bad: no built-in MCP, SKILL.md, ACP, or LSP support
* Bad: no permission model or OS sandboxing — full filesystem access, `--yes` skips all prompts
* Bad: no sub-agent orchestration; single model at a time (or architect+editor pair)
* Bad: no native AGENTS.md discovery; instruction files must be explicitly added via config
* Bad: no CI/CD integration; scriptable but requires manual setup
* Bad: no branch/PR creation; git-native but GitHub workflow requires external tools

### Cursor

* Good: full IDE experience — VS Code ecosystem, full LSP, all existing extensions work
* Good: OS-level sandboxing built-in (macOS Seatbelt, Linux Landlock+seccomp) — strongest sandbox among IDE-based tools
* Good: rich hooks system (20+ events); Run Modes with classifier-based auto-approval
* Good: cloud agents — multi-repo PR creation, BugBot automated review, GitHub/GitLab/Bitbucket triggers
* Good: Max Mode (up to 1M token context); semantic codebase indexing; checkpoint-based undo
* Good: BYOK supported; usage dashboard with both pools visible
* Good: SKILL.md (agentskills.io standard) now supported; reads `.agents/skills/`, `.cursor/skills/`, `.claude/skills/`, `.codex/skills/`; built-in skills for automations, review, PR babysitting
* Bad: proprietary (closed-source VS Code fork) — IDE lock-in
* Bad: subscription required for meaningful use; BYOK incurs Cursor Token Rate surcharge on non-Auto models
* Bad: no ACP support; no cross-client portability of config
* Bad: nested AGENTS.md applies by subtree but is not file-access-triggered JIT loading

### Amp

* Good: JIT subtree AGENTS.md loading + glob-activated context files — matches Gemini CLI for best nested context support
* Good: SKILL.md (agentskills.io standard); skills can bundle MCP servers
* Good: autonomous sub-agents with purpose-built specialists (Oracle second-opinion, Librarian GitHub search, Painter image generation)
* Good: Orbs — remote Debian VMs provide natural isolation from local machine; share terminal with agent
* Good: TypeScript plugin API with `agent.end` chaining — enables post-turn automation loops
* Good: secret auto-redaction (AWS, GCP, GitHub, OpenAI, Stripe tokens) before reaching LLM providers
* Good: pay-as-you-go without markup on model costs
* Bad: no user model selection — Amp controls which model each mode uses; no BYOK for individuals
* Bad: no built-in OS sandboxing; no approval flow by default
* Bad: no undo/redo; no git checkpoint mechanism
* Bad: no ACP support — no embeddability in other IDEs

### Windsurf / Devin Desktop

* Good: best-in-class OS sandboxing (`--sandbox` with Landlock/Seatbelt) plus full IDE LSP — security + developer experience
* Good: JIT nested AGENTS.md loading (same as Claude Code/Amp); reads AGENTS.md, .windsurfrules, CLAUDE.md, .cursor/rules
* Good: SKILL.md (agentskills.io); explicitly cross-client compatible
* Good: ACP support — JetBrains, Zed, Xcode; use Devin CLI inside any ACP-compatible editor
* Good: `/handoff` from local CLI to Devin Cloud for PR-aware CI-integrated workflows
* Good: hooks read Claude Code format (`.claude/settings.json`) — cross-client hook portability
* Good: free tier (SWE-1.6 Fast unlimited)
* Bad: proprietary (Cognition); no BYOK clearly documented for IDE/CLI product
* Bad: Windsurf (IDE) and Devin (CLI/cloud) are two distinct Cognition products with separate docs, pricing, and agent systems (Cascade vs Devin CLI) — onboarding complexity higher than single-product tools
* Bad: no undo/redo beyond Devin Cloud snapshots; local sessions ephemeral

### Kiro

* Good: spec-driven development as first-class workflow — requirements → design → tasks with parallel wave execution
* Good: supervised mode with mandatory hunk-level diff review — safest local approval flow after Copilot Workspace
* Good: AGENTS.md + steering files with `fileMatch`/`auto` modes for context-on-demand
* Good: SKILL.md (agentskills.io); Powers (MCP bundled with knowledge context)
* Good: ACP support (`kiro-cli acp`) — JetBrains, Zed
* Good: AWS-backed; cloud sandboxes; cross-repo changes in single web session
* Good: free tier (50 credits/mo)
* Bad: no BYOK — Kiro-managed model selection; no custom API key
* Bad: no OS-level sandboxing locally (only cloud web sessions are sandboxed)
* Bad: credit-based pricing with per-model multipliers and multiple tiers (Pro, Pro+, Pro Max, Power) — cost predictability harder than flat subscriptions
* Bad: ~1 year old; less battle-tested than Aider, Claude Code, Cursor

### Codex CLI

* Good: Apache-2.0 open source CLI (~98k stars); most community contributions of any CLI tool
* Good: SKILL.md (agentskills.io) with Record & Replay — demonstrate a workflow once, Codex generates a reusable skill automatically
* Good: strongest OS sandboxing of CLI tools — macOS Seatbelt + Linux bubblewrap + Windows Sandbox; all three platforms
* Good: most comprehensive hook system (`PreToolUse`, `PermissionRequest`, `PreCompact`, `SubagentStart/Stop`, etc.) with hash-verified trust model
* Good: GitHub Action (`codex github-action`); `@codex` on issues/PRs; Slack + Linear integrations
* Good: `PreCompact`/`PostCompact` hooks + nested AGENTS.md (root-to-CWD chain with override files)
* Good: ChatGPT plan auth — reuse existing subscription without per-token billing
* Bad: OpenAI-first; Bedrock as secondary; no multi-provider BYOK like Aider or Goose
* Bad: CLI binary is open-source but the service/models require ChatGPT account or API key
* Bad: no interactive `/undo` command — rollback relies on git checkpoints that must be created manually or via hooks; no automatic per-turn revert

### Goose

* Good: fully open source (Apache 2.0); AAIF/Linux Foundation governance — most vendor-neutral option
* Good: widest provider support (15+) including ACP providers — can use Claude Code, Codex, Amp, pi as backend
* Good: deepest MCP implementation — MCP Sampling, Elicitation, Roots, Apps; 70+ community extensions
* Good: SKILL.md (agentskills.io); community skills marketplace
* Good: both ACP server (`goose serve`) and ACP consumer — most composable architecture
* Good: free — only pay for LLM API; no Goose subscription or markup
* Bad: `.goosehints` is the primary instruction file, not AGENTS.md — less cross-client aligned than other tools
* Bad: no OS sandboxing on Linux/Windows natively (macOS optional; inherits from ACP provider)
* Bad: no built-in undo/redo; no git checkpoint mechanism
* Bad: no built-in git commit/PR creation; relies on GitHub MCP extension

### Cline

* Good: open-source (Apache 2.0); 64.6k stars; very active (313 releases)
* Good: widest provider support (30+) with full BYOK; Plan/Act can use different models
* Good: SKILL.md first-class support; reads `.claude/skills/` for cross-client portability
* Good: reads `AGENTS.md`, `.cursorrules`, `.windsurfrules` — most permissive instruction file detection
* Good: checkpoint undo per tool call (shadow git) — finest-grained rollback of any tool
* Good: SDK plugins with 14 hook stages — most programmable lifecycle of any VS Code extension
* Good: headless CLI for CI/CD; Kanban multi-agent board; connectors for Slack/Telegram/Discord/Linear
* Good: per-task cost visibility; enterprise OpenTelemetry observability
* Bad: no OS-level sandboxing — local machine execution with no container isolation
* Bad: VS Code + JetBrains as primary interface — no standalone TUI; JetBrains plugin not open source
* Bad: no JIT nested context file loading
* Bad: ACP support limited (Neovim only via adapter, not first-class)

### Gemini CLI

* Good: open-source (Apache 2)
* Good: true JIT / per-folder context loading — scans for `GEMINI.md` in accessed directories at tool-call time; best-in-class nested context support
* Good: `GEMINI.md` filename is configurable — can be set to `["AGENTS.md", "GEMINI.md"]` for cross-client compatibility
* Good: Agent Skills (SKILL.md) support with `.agents/skills/` alias; listed on agentskills.io
* Good: MCP support
* Good: plan mode (read-only), sandboxing, hooks, headless/scripting mode
* Good: Google-backed; large model selection
* Bad: primarily Google Gemini models by default; BYOK to other providers less seamless than OpenCode or Aider [verify]
* Bad: no built-in git commit/PR creation; relies on shell commands or MCP extensions for GitHub workflows

---

## Scoring Summary

Scores: `++` = 2, `+` = 1, `0` = 0, `-` = −1, `--` = −2.

`pi` is scored twice: **pi** = core only (no extensions installed); **pi+ext** = with the published extension ecosystem (5,296+ packages on pi.dev/packages covering sub-agents, MCP, LSP, web, sandboxing, plan mode, git checkpointing, permissions, memory, etc.).

| Category | Cursor | Cline | Claude Code | OpenCode | Codex CLI | pi+ext | Gemini CLI | Kiro | Windsurf/Devin | Goose | Amp | pi | Aider |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| LLM / BYOK | + | ++ | 0 | ++ | - | ++ | 0 | -- | - | + | -- | ++ | ++ |
| Context / compaction | ++ | + | ++ | + | + | ++ | + | ++ | + | 0 | + | + | 0 |
| Agentic loop | ++ | + | ++ | + | + | + | + | ++ | + | 0 | + | - | 0 |
| Tool set | ++ | + | + | ++ | + | + | + | ++ | ++ | + | + | - | 0 |
| Security | ++ | 0 | + | 0 | ++ | + | + | + | ++ | 0 | - | -- | -- |
| Extensibility | ++ | ++ | ++ | + | ++ | ++ | + | + | + | ++ | + | ++ | - |
| Workflow / TDD | + | + | ++ | + | + | + | 0 | ++ | 0 | 0 | + | 0 | + |
| Orchestration | ++ | ++ | ++ | + | + | + | 0 | ++ | + | + | ++ | - | - |
| Git / CI-CD | ++ | + | ++ | + | ++ | + | + | + | + | 0 | 0 | - | + |
| UX / surfaces | ++ | ++ | ++ | + | ++ | 0 | + | ++ | ++ | + | ++ | 0 | 0 |
| Cost / licensing | - | ++ | 0 | ++ | + | ++ | ++ | - | 0 | ++ | 0 | ++ | ++ |
| Open source | 0 | ++ | 0 | + | ++ | ++ | ++ | - | - | ++ | - | ++ | + |
| Open standards | + | + | + | ++ | + | + | ++ | ++ | ++ | 0 | + | 0 | -- |
| **Sum** | **18** | **18** | **17** | **16** | **16** | **16** | **13** | **13** | **11** | **10** | **6** | **3** | **1** |

---

## Links and Sources

> Add links to official docs, release notes, or benchmark posts used to fill in `[verify]` cells.

* [Claude Code docs](https://docs.anthropic.com/en/docs/claude-code/overview) — verified Jul 14, 2026
* [pi repo (earendil-works)](https://github.com/earendil-works/pi) — verified Jul 14, 2026
* [OpenCode docs](https://opencode.ai/docs) — verified Jul 14, 2026
* [Aider docs](https://aider.chat) — verified Jul 14, 2026
* [Cursor docs](https://docs.cursor.com) — verified Jul 14, 2026
* [Cline docs](https://docs.cline.bot) — verified Jul 14, 2026
* [Gemini CLI docs](https://github.com/google-gemini/gemini-cli/tree/main/docs) — verified Jul 14, 2026
* [Amp docs](https://ampcode.com/manual) — verified Jul 14, 2026
* [Amp models](https://ampcode.com/models) — verified Jul 14, 2026
* [Windsurf / Devin Desktop docs](https://docs.devin.ai) — verified Jul 14, 2026
* [Kiro docs](https://kiro.dev/docs) — verified Jul 14, 2026
* [Kiro pricing](https://kiro.dev/pricing/) — verified Jul 14, 2026
* [Codex CLI repo](https://github.com/openai/codex) — verified Jul 14, 2026
* [Goose docs](https://goose-docs.ai) — verified Jul 14, 2026
* [Goose repo](https://github.com/aaif-goose/goose) — verified Jul 14, 2026
* [Agent Skills standard](https://agentskills.io) — verified Jul 14, 2026 (44 client implementations counted)
* [ACP — Agent Client Protocol](https://agentclientprotocol.com) — verified Jul 14, 2026
* [MCP — Model Context Protocol](https://modelcontextprotocol.io) — verified Jul 14, 2026
* [Cursor Agent Skills](https://cursor.com/docs/context/skills) — verified Jul 14, 2026
* [nono sandbox](https://nono.sh) — verified Jul 14, 2026
* [nono pi profile](https://registry.nono.sh/packages/always-further/pi) — verified Jul 14, 2026
* [pi containerization docs](https://pi.dev/docs/latest/containerization) — verified Jul 14, 2026
* [pi package catalogue](https://pi.dev/packages) — verified Jul 14, 2026 (5,296+ packages)
