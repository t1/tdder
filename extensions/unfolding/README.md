# Unfolding extension

Implements the **Unfolding Specs** workflow: the orchestrator owns only the top-level PO task, while
specialist roles (PO, architect, coder, …) coordinate through runtime-managed delegated tasks and
live task files.

## Usage

**`/unfold` command:** injects the `unfolding-orchestrator` skill into the current session and
starts the Unfolding Specs process. Run it in any project where you want to unfold a feature.

Pass `--debug` to export sessions to HTML for inspection. Debug exports are written to
`.pi/unfolding/exports/` with these triggers:

- child session → `.pi/unfolding/exports/<local-iso-timestamp>-<slug>.html` on `task_finished`, `task_block`, and
  aborted child outcomes
- commissioner session → `.pi/unfolding/exports/<local-iso-timestamp>-<slug>.commissioner.html` on `task_delegate`,
  `task_reopen`, and `task_unblock`

The timestamp uses local time in ISO format to the second (`YYYY-MM-DDTHH:MM:SS`).

## Connecting to an aborted session

Press **Esc** at any time to abort the full running stack. After the abort settles, a session
picker appears listing every sub-session that was running at the time, plus a **Stay here**
option (equivalent to pressing Esc again).

Selecting a sub-session opens it in a **new tmux window** (requires tmux):

```
tmux new-window -n <slug> "pi --session <session-file>"
```

This gives you a real interactive pi session with the full conversation history of that role,
so you can talk to it directly without the orchestrator in the loop.

**Warning:** `/connect-session` starts a fresh `pi --session` process. It does **not** currently
guarantee the same extension set or the same nono sandbox as the session you launched it from.
If you rely on extension-provided tools/widgets or nono confinement, verify them again in the
connected session.

When you are done, close the tmux window and use `/resume` in the root session to pick up where
you left off, or start a new `/unfold` run.

If you are **not inside tmux**, a notification shows the `pi --session <file>` command to run
manually instead.

## Task tools

Used by the orchestrator and delegate sub-sessions to coordinate work:

| Tool            | Used by                             | Purpose                                                                         |
|-----------------|-------------------------------------|---------------------------------------------------------------------------------|
| `task_delegate` | orchestrator, delegate commissioner | Delegate new work to one direct role sub-session; blocks until finished/blocked |
| `task_continue` | orchestrator, delegate commissioner | Continue the one current direct delegate task and return its current outcome    |
| `task_list`     | orchestrator                        | List delegated tasks for orchestrator diagnosis/investigation                   |
| `task_read`     | orchestrator                        | Read full details of a task for orchestrator diagnosis/investigation            |
| `task_accept`   | orchestrator                        | Accept a finished task (deletes the file; point of no return)                   |
| `task_reopen`   | orchestrator                        | Send a finished task back with a reason; child resumes                          |
| `task_unblock`  | orchestrator                        | Unblock a blocked task, optionally with context; child resumes                  |
| `task_rollback` | orchestrator                        | Restore the workspace to its pre-delegation state and delete task               |
| `ask_sensei`    | orchestrator, delegate              | Ask the human a single question via pi UI and return the answer                 |
| `task_finished` | delegate                            | Mark own task finished; blocks until orchestrator accepts/reopens               |
| `task_block`    | delegate                            | Mark own task blocked with reason, or request automatic child-session recreation | 

## Coordination protocol

Tasks are stored as YAML files in `.pi/unfolding/tasks/` (gitignored).
Parent and child sessions are separate pi processes; they rendezvous by polling the task file
at 500 ms intervals. No shared memory or locking is used. Task files are live coordination state, not
long-term workflow history: `task_accept` and `task_rollback` both delete the task file.

## Child-session recreation via `task_block`

A child role can ask the commissioner to recreate its delegated session — for example to pick up a tool set that only becomes available after a bootstrap step — by calling `task_block` with `recreate.resume_message`. The commissioner checkpoints the task and launches a fresh child session seeded with the resume message.

- `task_block` and `task_finished` both return `terminate: true`.
- Recreation is a normal `task_block` capability, not a side effect of another tool's result.

This keeps unfolding generic: it exposes its own session-ending tools and the recreation kick-off, but does not know which technology prompted the request.

`task_block` supports two mutually exclusive outcomes:

- normal block: `blocked_reason`
- automatic recreation request: `recreate.resume_message`

When a child requests recreation, the commissioner runtime recreates that same child session automatically
for the same task and resumes it with the supplied message, without surfacing the intermediate block to the commissioner LLM.

The extension also writes `.pi/unfolding/tasks.yaml` as a compact live summary for humans. It contains only the
currently existing task chain, ordered by creation order, and is deleted when no tasks remain. It is never read for
workflow control. The summary is derived from live task files only.

## Child-session live output

Delegated child progress forwarded into the commissioner session includes
live tool rows (`⚙`) with in-place human-readable elapsed timers (`59s`, `1m 5s`, `2h 3m 4s`) plus terminal markers (
`✓` / `✗`), forwarded child extension UI display updates such as status lines and string-array widgets (for example the
live Maven progress widget), a total running-time line
at the end (`[role] ⏱ total context-size cost`), nested delegated-task live updates, assistant text (`💬`), assistant
thinking (`🤔`, rendered italic),
assistant stream errors (`❌`), terminal child-session failures surfaced from assistant `message_end`
(such as connection/stream aborts), and an explicit warning when a thinking-bearing assistant message is truncated
by the length limit (`⚠ thinking truncated by length limit`).

Interactive child UI is also proxied to the root session: descendant `ask_sensei`, confirm/select/input/editor dialogs,
and TUI pickers are shown to the human with role labeling (for example `[architect]`).

When a parent session has finished sub-sessions, their cost is shown behind the parent's own cost as a descendant
sum: `[role] ⏱ total context-size $1.23 (+ $4.50)`. The `(+ $X)` is the sum of all **finished** descendant
sessions — a currently running sub-session is excluded until it ends.

After the orchestrator stops working (no live tasks remain, ledger has entries, not yet printed this engagement),
a **cost summary table** is printed as a display-only message (visible to the user, not fed back to the LLM):

```
unfolding cost summary

role          slug           cost
──────────────────────────────────────────
po            po-spec ✓      $1.23
architect     arch-v1 ✗      $4.50
orchestrator                 $0.50
──────────────────────────────────────────
grand total                  $6.23
```

Each delegated session gets one row (role, slug, ✓/✗ marker, cost). ✓ marks
finished sessions; ✗ marks blocked, rolled-back, and aborted ones. Recreated
sessions (new session file) appear as separate rows because each session file
accumulates cost independently. The orchestrator row (empty slug, no marker) is
last before the grand total. Block/unblock cycles on the same session file are a
single row because `getSessionStats()` aggregates over the whole session file —
cost is cumulative and does not reset on resume.

It intentionally skips low-value protocol/lifecycle chatter such as `agent_start`, `agent_end`, `turn_start`,
`message_start`, and assistant stream markers like `text_start`/`text_end`, `thinking_start`/`thinking_end`,
`toolcall_*`, `start`, and `done`. Unexpected new child event types are rendered as compact transcript notes
with reduced metadata plus a child session-log reference, so protocol drift stays visible without dumping raw JSON.

## Checkpoint recovery

Unfolding distinguishes three failure classes before a child reaches
`task_finished` or `task_block`:

- `stopReason: "length"` (truncation) → queue exactly one follow-up recovery prompt on the same child session
- normal turn end without a checkpoint → queue exactly one follow-up reminding the child to call `task_finished` or
  `task_block`
- child-session/provider/stream failure (`stopReason: "error"`, `"aborted"`, connection/stream errors) → block
  immediately with an honest system-generated reason instead of pretending the child merely forgot the protocol step

If truncation or missing-checkpoint recovery still fails on the follow-up turn, the task becomes a normal
blocked task with the corresponding honest system-generated reason, and the commissioner then decides whether to
`task_unblock` or `task_rollback`.

## Rollback mechanics

If the project is not yet a git repository, unfolding initializes one with an
internal initial commit before the first delegated task that needs rollback metadata, and posts a visible
note that it did so. Delegated tasks then record `base_sha` and, when the workspace was already dirty, an
internal `snapshot_sha`. `task_rollback` restores the exact pre-task state, including tracked files,
untracked files, and pre-existing dirty workspace changes. This design assumes serialized child execution
in a shared workspace; parallel code-writing child sessions would require isolated workspaces.

## Delegation cardinality

In pi, every commissioner may have at most one direct delegate task at a time. A commissioner must resolve that direct
child with `task_accept`, `task_reopen`, `task_unblock`, or `task_rollback` before creating another. If a commissioner
is resumed while waiting on that child, it should call `task_continue` rather than `task_delegate`.

The Orchestrator is just another commissioner here, with one additional ownership rule: its only valid direct delegate
is the top-level PO task. It must not directly commission Architect, Coder, UI Expert, UX Designer, or API Designer.

`task_list` and `task_read` remain intentionally available to the Orchestrator as live-workflow diagnostics. The
Orchestrator may use them both when the Sensei asks for investigation and when it detects an obvious workflow anomaly on
its own, such as an unclear blockage, an unresolved finished top-level PO task, or inconsistent task metadata. That
investigation scope is still limited to coordination state; it does not authorize code-level supervision or bypassing
normal PO-owned delegation.

These git commits are **internal rollback mechanics**, not semantic project history. Delegated roles must not create
semantic feature commits, because an ancestor commissioner may later roll back their entire subtree. Only the
**Orchestrator** may create durable semantic project commits.

## Roles and decision ownership

**Roles:** pi-native agent definitions live in `extensions/unfolding/roles/<role>.md`.
The orchestrator role is defined by the `unfolding-orchestrator` skill.
When `task_delegate` receives a role name it strips any `unfolding-` prefix, so both
`"po"` and `"unfolding-po"` resolve correctly.
Built-in roles: `po`, `architect`, `coder`, `api-designer`, `ux-designer`, `ui-expert`.

### Role file frontmatter

Each role file has a YAML frontmatter block with these keys:

```yaml
---
name: <role>           # short role name
description: >         # one-line description
  ...
model: opus|sonnet     # preferred model
tools:                 # tool allowlist (required)
  - read
  - write
  - idea_*             # wildcard: expands to all live tools matching the prefix
delegates-to:          # required: exact roles this role may delegate to
  - architect
  - ux-designer
path-restrictions:     # optional path-level restrictions for read/write/edit
  - read deny: docs/adr/**
  - read allow: docs/**
  - read deny: **
---
```

**`tools:`** is an allowlist — only the listed tools are available to the role.
Everything not listed is excluded, including tools from future extensions.
Wildcard entries (e.g. `idea_*`, `browser_*`) are resolved against the live tool
registry at child session spawn time, so dynamically registered MCP tools are
included when available and silently absent when not.

**`delegates-to:`** is the runtime-enforced delegation policy for `task_delegate`.
The tool rejects any role not listed there, and task-tree validation also fails if persisted live tasks violate the declared chain.
Use `delegates-to: []` for roles that must never delegate.

**`path-restrictions:`** applies fine-grained path-level restrictions to `read`,
`write`, and `edit` calls. Each rule has the form:

```
<tools> <action>: <glob>
```

- `tools`: `read`, `write`, `edit`, or `rw` (shorthand for all three)
- `action`: `allow` or `deny`
- `glob`: project-relative path glob

Rules are evaluated in order; **the first matching rule wins**. If no rule matches,
the path is allowed. Example (PO: docs only, no ADRs):

```yaml
path-restrictions:
  - read deny: docs/adr/**   # ADRs are technical — PO must not read them
  - read allow: docs/**      # rest of docs/ is fine
  - read deny: **            # everything else (source, build files) is off-limits
```

**Shared preamble:** the unfolding extension automatically appends a shared
anti-workaround instruction to every role's system prompt at spawn time:

> If achieving a goal requires combining tools in a way that isn't their stated
> purpose, stop and use `task_block` or `ask_sensei` rather than improvising.

This is injected by the extension, not written per-role, so it cannot be
accidentally omitted from a new role file.

**Adding a new role:** create `extensions/unfolding/roles/<name>.md` with
frontmatter following the schema above. Add tests in
`extensions/unfolding/test/unfold-command.test.ts` asserting the expected
`tools:`, `delegates-to:`, and `path-restrictions:` entries — the test suite enforces that every
role file declares them explicitly.

**Decision escalation:** normal ADR/DMD questioning is direct.
The Architect asks ADR questions, and the PO asks DMD questions. The Orchestrator is no longer the normal relay path
for those decisions.

Blocked questions still go to the current role's **commissioner** first when they are genuine commissioner issues rather
than normal ADR/DMD questioning. The commissioner may answer directly only within that commissioner's own decision
authority; roles must not bypass that chain.

For Architect → PO escalation: the PO may answer only PO-scope business questions. The PO must not read or interpret
ADRs and must never answer technical questions. If a technical question arrives, the PO sends it back and tells the
Architect to ask the Sensei directly. This includes technical implementation problems during execution, not just formal
architectural decisions. The Architect should describe such problems briefly to the Sensei with the relevant local
context and constraints; only if the answer changes a durable architectural rule should the Architect then write or
update an ADR. If a question is mixed, the PO sends it back and requires the Architect to remove its technical aspects,
ask those directly, and bring back only any remaining PO-scope business question.

For PO → Architect handoff: the PO may pass product intent, scope, business rules, user-visible behavior, delivery
channel, and externally visible product contract. Product-scope terms such as `webapp`, `mobile app`, `CLI`, or `API`
describe only the delivery channel or public contract and do not authorize any stack inference. Protocol or contract
words such as `REST`, `REST/JSON`, `GraphQL`, `webhook`, `event stream`, `JSON`, or `public API` are valid PO input
only when the handoff itself explicitly names the external consumer, states the business value of programmatic
integration, and makes that public contract part of the product requirement; otherwise they are premature technical
steering. Framework, build-tool, storage, and other internal implementation choices remain outside PO scope. The PO
must not add technical instructions, recommendations, or unauthorized technical inference of their own. If technical
guidance is passed through from the Sensei, it must be clearly labeled as such. The Architect must refuse unlabeled or
unsupported technical steering from the PO, block, require rollback of the malformed `[ARCH]` task, and request a fresh
business-only handoff.

Decision ownership is strict:

- **PO** owns **DMDs**
- **Architect** owns **ADRs**
- **All other roles** only raise questions; they do not classify them as DMDs or ADRs
- **Orchestrator** coordinates and tracks state; it does not classify decision substance

A commissioner may create only the decision artifact their own role owns. In particular, the
Architect must never decide that something needs a DMD — if a question is not architectural,
the Architect escalates it upward neutrally and the PO decides whether it becomes a DMD.

## Testing

### Regular tests

Run the extension test suite with:

```bash
npm --prefix extensions/unfolding test
```

### File-based integration test

Run the file-polling integration test with:

```bash
npm --prefix extensions/unfolding run test:integration
```

### Real pi integration test

Run the real unfolding smoke harness with the default model:

```bash
npm --prefix extensions/unfolding run test:real-integration
```

Run it with an explicit model:

```bash
UNFOLDING_TEST_MODEL=provider/modelId npm --prefix extensions/unfolding run test:real-integration
```

The real integration harness reads the requested model from `UNFOLDING_TEST_MODEL`.
It prints the temp workspace path at the start of the run.
It prints a JSON summary including the requested model, selected root model,
child session files, child models, generated artifacts, and task files. It also writes the same summary to
`unfold-result.json` in the temp workspace used for that run.
Temp workspaces are kept for inspection; remove them with:

```bash
npm --prefix extensions/unfolding run clean
```
