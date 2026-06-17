# Unfolding Specs for pi — v1 design summary

This document summarizes the current design decisions for a **pi-specific**
implementation of Unfolding Specs.

It does **not** change the existing Claude Code implementation. Claude can keep
using its native task list and agent model. This document only describes the pi
extension/runtime design.

## Scope

v1 optimizes for:

- correctness over performance
- bounded context per role thread
- simpler orchestration than async/parallel variants
- synchronous delegation only
- recoverability from durable task state where possible

v1 explicitly does **not** attempt:

- parallel delegated sub-sessions
- async task delegation
- visible paused task states
- a shared Claude/pi coordination substrate

## High-level model

- The pi orchestrator owns scheduling.
- In v1, the orchestrator is hybrid: the main pi session is the human-visible orchestrator, while the extension runtime
  implements the orchestration mechanics.
- Top-level orchestration is phase-driven from `docs/state.yaml`.
- Delegated subtask orchestration is task-driven from `.pi/unfolding/tasks/`.
- A role session stays focused on **one work thread**.
- The orchestrator must never add a second active work thread for the same role session.
- A work thread may be phase-driven top-level work or a delegated subtask thread.
- A role session has an active delegated thread from the moment it starts work on a commissioned delegated task until
  that thread is fully resolved, including any parked delegated child sessions awaiting commissioner action.
- When the last delegated task in a delegated thread is accepted, the next delegated thread for that role must start in
  a **fresh sub-session**.
- Compaction is **not** sufficient isolation between unrelated task threads.

## Durable vs private state

### Durable tracked state

`docs/state.yaml` stays minimal and contains only:

- feature name
- feature slug
- phase

No task slugs are stored there in v1.

### Private pi runtime state

Delegated subtask state lives in:

- `.pi/unfolding/tasks/`

These task files are pi runtime state, not durable documentation artifacts.
Top-level orchestration does not require top-level task files in v1.

## Git ignore rule

The first task-writing operation must ensure the root `.gitignore` contains:

```gitignore
.pi/unfolding/tasks/
```

This is runtime responsibility, not agent responsibility.

## Task identity and storage

- Public logical task identity is the **slug**.
- Task file names should be opaque/runtime-oriented, not semantic.
- Task tools should expose slugs, not file paths.
- Slugs must be unique **globally among non-accepted delegated tasks**.
- Task files exist only for delegated subtasks in v1.

## Task file schema

Required metadata:

- `slug`
- `status`
- `from`
- `to`

Optional metadata:

- `references`
- `blocked_reason`
- `parent_slug`
- `session_id`

Notes:

- `from` / `to` are role names, e.g. `po`, `architect`, `coder`.
- `parent_slug` is included in v1 for delegated child tasks.
- `session_id` is stored in the task file for ad-hoc debugging only. It is not used by the v1 runtime.

## Task statuses

v1 task statuses are:

- `in_progress`
- `finished`
- `blocked`

Semantics:

- `finished` means the assignee claims the task is done.
- `blocked` means the assignee cannot continue and needs commissioner action.
- `blocked` is not just a pause.
- `blocked_reason` is required when status is `blocked`.

## Status ownership

- `task_delegate` creates the task file as `in_progress` after the sub-session is started
- assignee sets `finished`
- assignee sets `blocked`
- commissioner sets `unblock` (back to `in_progress`)
- commissioner sets `reopen` (back to `in_progress`)
- commissioner accepts the task

In v1, acceptance deletes the task file.
Accepted tasks are deleted from the private task store; it is not a history log.

## Tooling policy

Task tools are the normal interface for task mutation.

- raw task files do **not** need to be hard-blocked
- task file paths do **not** need to be advertised
- agents should be guided to use task tools for create/update/delete
- direct raw reads may still be useful for inspection/debugging
- task browsing/reading belongs to the orchestrator, not to delegated sub-sessions
- delegated sub-sessions are invoked with exactly one current delegated task in context
- top-level role runs are invoked from `docs/state.yaml`, not dispatched from task files

## v1 task tools

### Orchestrator only

- `task_list`
- `task_read`

### Assignee tools

- `task_finished`
- `task_block`

### Commissioner tools

- `task_delegate`
- `task_accept`
- `task_reopen`
- `task_unblock`

### Tool intent

- `task_read` -> orchestrator reads authoritative current delegated task state for invocation
- `task_finished` -> set task to `finished` and wait for commissioner decision
- `task_block` -> set task to `blocked` and wait for commissioner decision
- `task_unblock` -> commissioner moves a blocked child task back to `in_progress` and resumes it
- `task_accept` -> commissioner accepts a finished child task and deletes it
- `task_reopen` -> commissioner moves a finished child task back to `in_progress` and resumes it
- `task_delegate(role, body)` -> create child task, invoke a fresh sub-session with the given role skill and task body,
  wait for child to reach `finished` or `blocked`, then return that outcome to the parent. The runtime appends a fixed
  instruction to the initial message reminding the child to use `task_finished` or `task_block`.

## Delegation model

v1 uses **synchronous delegation** only.

That means:

1. parent calls `task_delegate(role, body)`
2. child role sub-session is started; task file is written as `in_progress` with the new `session_id`
3. child works until it reaches a commissioner decision point:
    - `task_finished`, or
    - `task_block`
4. `task_delegate` returns to the parent immediately at that point
5. child session remains internally parked
6. parent decides:
    - `task_accept`
    - `task_reopen`
    - `task_unblock`
7. that decision resolves the parked child wait

This parked state is **internal runtime state only**. It is not part of the
agent-relevant task model.

`finished` and `blocked` are task states relevant to agent behavior, while
parked/waiting is runtime control-flow state only.

A parked child session is still part of the parent's active task thread. While
such a parked child exists, the orchestrator must not reuse that role session
for a new unrelated delegated thread.

## Child-facing fixed resume messages

These messages are fixed by the runtime and not customizable.

For `task_unblock`:

- `unblocked`
- `unblocked: <reason>`

For `task_reopen`:

- `reopened: <reason>`

For `task_accept`:

- `accepted. you can close your session now`

## Commissioner notes

- `task_reopen` requires a reason.
- `task_unblock` may include an optional reason.

Rationale:

- reopening always needs an explanation
- unblocking sometimes just means “continue”, and sometimes carries new information

## Implementation notes

### `/unfold` command

`/unfold` operates in the **current pi session**. It does not spawn a
sub-session for the orchestrator. The `unfolding-orchestrator` skill is
loaded into the current session as a prompt injection.

### Role sub-session system prompts

Role agent definitions live in `agents/unfolding-<role>.md` in the tdder
repo root (e.g. `agents/unfolding-po.md`). These are Claude Code format
agent definition files.

`task_delegate` loads these files directly:

- Strips the frontmatter
- Uses the markdown body as the system prompt
- Uses the default model and default tools for v1

Frontmatter interpretation (model name mapping, tool name mapping) is
explicitly **out of scope for v1**.

### Parked session mechanics

Both sides of a delegation are blocking tool calls that rendezvous through
the task file:

- `task_finished` / `task_block` (child side) — block and wait for a
  commissioner decision
- `task_delegate` (parent side) — blocks after spawning the child, waiting
  for the child to reach `finished` or `blocked`

The child sub-session stays alive (paused at its tool call) while the
parent is also alive (paused at `task_delegate`). This model needs to be
validated against pi's actual sub-session capabilities during
implementation.

## Coordination protocol

### File-based polling (both sides)

Parent and child coordinate exclusively through the task file:

- `task_delegate` (parent) — polls until status is `finished` or `blocked`
- `task_finished` / `task_block` (child) — write the new status, then poll until
  status is `null` (file deleted = accepted) or `in_progress` (reopened/unblocked)

This replaces any in-process signalling mechanism (e.g. a `ParkingLot` Promise map).
In-process mechanisms cannot work because `createAgentSession` loads the extension
fresh for each sub-session, giving parent and child independent closure state.

### Thread safety

No file locking is needed. The coordination protocol is inherently sequential: the
child writes its status and parks; the parent reads and decides; the parent acts
(write or delete); the child's poller detects the change. They never write
simultaneously, and Node.js is single-threaded so operations within one microtask
cannot be interleaved with another in the same process.

### Polling vs. fs.watch

v1 uses polling at 500 ms intervals. `fs.watch` (FSEvents / inotify) would give
lower latency without busy-wait and is a straightforward later improvement. It is
not used in v1 because:

- `fs.watch` has a history of platform quirks
- inotify can miss events on network filesystems and some container setups
- latency at the 500 ms scale is acceptable for feature delegation

## Out of scope for v1

Potential later additions, intentionally deferred:

- async/non-blocking `task_create` or `task_delegate(nowait=true)`
- explicit paused task state
- parallel delegated sub-sessions for safe independent work
- multiple simultaneous threads per role
- richer durable state breadcrumbs in `docs/state.yaml`
- stronger raw task-file access restrictions
- agent file frontmatter interpretation:
    - model selection (needs local mapping, e.g. `opus` to an available model)
    - tool name mapping
- session restore (see v2 plan below)

## v2: session restore plan

### Failure modes in scope

v1 coordination is purely file-based. Both sides hold blocking tool calls that
poll the task file. If either process dies while polling, the handshake stalls:

- **Child dies** (e.g. crash, manual kill, laptop sleep): task file is stuck at
  `finished` or `blocked`. Commissioner can still act on the file, but no child
  is polling `waitForResume`. `task_accept` is safe (nothing to resume). For
  `task_reopen` and `task_unblock` the runtime must spawn a fresh child session.

- **Parent dies**: task file may be stuck at any status. The child may still be
  alive and polling `waitForResume`. Recovery means the parent reconnects to the
  child's existing session before acting.

- **Both die**: restart everything from the task file.

### What `session_id` enables

The `session_id` in the task file identifies the child's pi session. The pi SDK
exposes `SessionManager.list(cwd)` which returns all sessions for a project.
A session has a `sessionId` (UUID) and a `sessionFile` (`.jsonl` path).
`SessionManager.open(path)` then loads a specific session so it can be passed
to `createAgentSession`.

This means session restore by `session_id` is feasible: find the `.jsonl` whose
header UUID matches, open it, pass it to `createAgentSession`. The session
resumes from where it left off (paused inside `waitForResume`).

### Open question

It is not yet confirmed whether a session restored via `SessionManager.open`
and `createAgentSession` will correctly resume a tool call that was interrupted
mid-execution (i.e. inside `waitForResume`'s polling loop). This must be
validated against pi's actual session/runtime capabilities before implementing
restore.

### Recovery matrix (v2 target)

| Task status  | Child alive? | Action          | Strategy                                      |
|--------------|-------------|-----------------|-----------------------------------------------|
| `finished`   | yes (parked) | `task_accept`   | write file; child's poll detects deletion     |
| `finished`   | yes (parked) | `task_reopen`   | write file; child's poll detects `in_progress`|
| `finished`   | no           | `task_accept`   | delete file; no child to notify               |
| `finished`   | no           | `task_reopen`   | spawn fresh child with `"reopened: <reason>"`  |
| `blocked`    | yes (parked) | `task_unblock`  | write file; child's poll detects `in_progress`|
| `blocked`    | no           | `task_unblock`  | spawn fresh child with `"unblocked[: <reason>]"`|
| `in_progress`| yes          | (recover parent)| restore parent; reconnect to child session    |
| `in_progress`| no           | (recover parent)| restore parent; spawn fresh child             |

"Child alive" = child pi process is still running and polling `waitForResume`.
Detecting liveness is not trivial; a pragmatic v2 heuristic: try
`SessionManager.open` + `createAgentSession`; if it fails or times out, fall
back to spawning fresh.

### Fixed restart messages (v2)

When a fresh child session is spawned as a fallback, the resume message is
prefixed with a fixed restart notice so the child knows continuity was lost:

- `restarted after interruption. determine where you left off and continue. reopened: <reason>`
- `restarted after interruption. determine where you left off and continue. unblocked`
- `restarted after interruption. determine where you left off and continue. unblocked: <reason>`

`task_accept` never restarts the child — the child does not need to continue.
