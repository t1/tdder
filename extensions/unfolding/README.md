# Unfolding extension

Implements the **Unfolding Specs** workflow: the orchestrator breaks a feature down into delegated
tasks for specialist roles (PO, architect, coder, …), coordinates them through file-based
checkpoints, and assembles the results.

## Usage

**`/unfold` command:** injects the `unfolding-orchestrator` skill into the current session and
starts the Unfolding Specs process. Run it in any project where you want to unfold a feature.

## Task tools

Used by the orchestrator and delegate sub-sessions to coordinate work:

| Tool            | Used by      | Purpose                                                            |
|-----------------|--------------|--------------------------------------------------------------------|
| `task_delegate` | orchestrator | Delegate work to a role sub-session; blocks until finished/blocked |
| `task_list`     | orchestrator | List all tasks with slug, status, and assigned role                |
| `task_read`     | orchestrator | Read full details of a task                                        |
| `task_accept`   | orchestrator | Accept a finished task (deletes the file; point of no return)      |
| `task_reopen`   | orchestrator | Send a finished task back with a reason; child resumes             |
| `task_unblock`  | orchestrator | Unblock a blocked task, optionally with context; child resumes     |
| `task_rollback` | orchestrator | Restore the workspace to its pre-delegation state and delete task  |
| `task_finished` | delegate     | Mark own task finished; blocks until orchestrator accepts/reopens  |
| `task_block`    | delegate     | Mark own task blocked with reason; blocks until orchestrator acts  |

## Coordination protocol

Tasks are stored as YAML files in `.pi/unfolding/tasks/` (gitignored).
Parent and child sessions are separate pi processes; they rendezvous by polling the task file
at 500 ms intervals. No shared memory or locking is used. Task files are coordination state, not
long-term workflow history: `task_accept` and `task_rollback` both delete the task file.

## Child-session live output

Delegated child progress forwarded into the commissioner session includes
live tool rows (`⚙`) with in-place elapsed timers plus terminal markers (`✓` / `✗`), a total running-time line
at the end (`[role] ⏱ total`), nested delegated-task live updates, assistant text (`💬`), assistant thinking (`🤔`),
assistant stream errors (`❌`), terminal child-session failures surfaced from assistant `message_end`
(such as connection/stream aborts), and an explicit warning when a thinking-bearing assistant message is truncated
by the length limit (`⚠ thinking truncated by length limit`).
It intentionally skips low-value protocol/lifecycle chatter such as `agent_start`, `agent_end`, `turn_start`,
`message_start`, and assistant stream markers like `text_start`/`text_end`, `thinking_start`/`thinking_end`,
`toolcall_*`, `start`, and `done`. Unexpected new child event types are rendered as compact transcript notes
with reduced metadata plus a child session-log reference, so protocol drift stays visible without dumping raw JSON.

## Checkpoint recovery

Unfolding distinguishes three failure classes before a child reaches
`task_finished` or `task_block`:

- `stopReason: "length"` (truncation) → queue exactly one follow-up recovery prompt on the same child session
- normal turn end without a checkpoint → queue exactly one follow-up reminding the child to call `task_finished` or `task_block`
- child-session/provider/stream failure (`stopReason: "error"`, `"aborted"`, connection/stream errors) → block immediately with an honest system-generated reason instead of pretending the child merely forgot the protocol step

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

## Roles and decision ownership

**Roles:** pi-native agent definitions live in `extensions/unfolding/roles/<role>.md`.
The orchestrator role is defined by the `unfolding-orchestrator` skill.
When `task_delegate` receives a role name it strips any `unfolding-` prefix, so both
`"po"` and `"unfolding-po"` resolve correctly.
Built-in roles: `po`, `architect`, `coder`, `api-designer`, `ux-designer`, `ui-expert`.

**Decision escalation:** blocked questions always go to the current role's **commissioner** first.
The commissioner either answers directly or routes the question onward; roles must not bypass
that chain. Decision ownership is strict:

- **PO** owns **DMDs**
- **Architect** owns **ADRs**
- **All other roles** only raise questions; they do not classify them as DMDs or ADRs
- **Orchestrator** only relays and tracks state; it does not classify decision substance

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

The real integration harness prints a JSON summary including the requested model, selected root model,
child session files, child models, generated artifacts, and task files.
