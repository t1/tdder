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
- `session_id` stores the current session handling the task thread. This is
  useful for debugging and may be used for session restoration.

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

- `task_read` -> orchestrator reads authoritative current delegated task state for invocation/recovery
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

### Fresh restart of an interrupted `in_progress` session

- `restarted after interruption. determine where you left off and continue.`

### Exact restore / parked-session resume

For `task_unblock`:

- `unblocked`
- `unblocked: <reason>`

For `task_reopen`:

- `reopened: <reason>`

For `task_accept`:

- `accepted. you can close your session now`

### Fresh restart after failed parked-session restore

These use a fixed prefix plus the normal commissioner message:

- `restarted after interruption. determine where you left off and continue. unblocked`
- `restarted after interruption. determine where you left off and continue. unblocked: <reason>`
- `restarted after interruption. determine where you left off and continue. reopened: <reason>`

`task_accept` does not restart the child session.

## Commissioner notes

- `task_reopen` requires a reason.
- `task_unblock` may include an optional reason.

Rationale:

- reopening always needs an explanation
- unblocking sometimes just means “continue”, and sometimes carries new information

## Session lifecycle

- Session replacement is allowed if it is truly equivalent to starting fresh.
- Compaction is not sufficient.
- On acceptance, the runtime should ideally resolve the child wait normally, not just kill the child session externally.
- Top-level phase-driven orchestration remains in the main pi session unless the human explicitly starts a new one.

## Restore workflow policy

The restore model has three distinct cases in v1:

### 1. Session restore for active work

For `in_progress` tasks, the runtime should prefer exact session restore.

Preferred behavior:

1. if the task has a `session_id`, try to restore that exact session
2. if restore is unavailable or fails, start a fresh session for the same task thread

This is policy, not yet a guaranteed pi capability in every case.

### 2. Parked child-session recovery

Delegated child sessions that are parked after `task_finished` or `task_block`
are a separate recovery category.

- they remain part of the same active thread
- they are waiting for commissioner action
- they must not be treated as if the parent thread were free for unrelated new work

Parked child sessions are therefore not just another task-status case. They are
an internal runtime/session-state concern and the main technical complexity in
restore behavior.

### Recovery cases considered so far

- `in_progress`: restore exact session if possible; otherwise restart the same task thread fresh
- `finished`: commissioner can review/accept/reopen
- `blocked`: commissioner can inspect reason and unblock
- parked child session: separate recovery category; see "Failed parked-session restoration" below

### Important recovery linkage

Delegated child tasks must store:

- `parent_slug`
- `session_id`

This is needed for recovery/debugging, even in v1.

### Failed parked-session restoration

If a parked child session cannot be restored by `session_id`, v1 resolves it as
follows:

- `task_accept` finalizes directly without restarting the child session
- `task_reopen` starts a fresh child session and moves the task back to `in_progress`
- `task_unblock` starts a fresh child session and moves the task back to `in_progress`

The fresh child session receives the normal fixed commissioner message, prefixed
with the fixed restart notice:

- `restarted after interruption. determine where you left off and continue. reopened: <reason>`
- `restarted after interruption. determine where you left off and continue. unblocked`
- `restarted after interruption. determine where you left off and continue. unblocked: <reason>`

Rationale:

- `task_accept` means the child does not need to continue working
- `task_reopen` and `task_unblock` both require the child to continue, but the
  restarted session must be told both that continuity was lost and that it must
  reconstruct where the thread left off

This is reconstructive recovery, not exact continuity.

### Implementation note: exact use of restored sessions in pi

The design prefers restoring by `session_id`, but the exact mechanics must be
validated against pi's actual session/runtime capabilities during
implementation.

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
