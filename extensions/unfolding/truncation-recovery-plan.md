# Truncation recovery plan

## Assumptions

This plan is valid only under these current constraints:

- delegated child sessions execute **serially**
- all child sessions share the **same workspace**
- non-technical commissioners must **not inspect code or diffs**
- task files are **coordination state**, not workflow history
- git snapshot commits are **internal rollback mechanics**, not user-facing history

If unfolding later runs code-writing child sessions in parallel, this design is no longer sufficient and must move to per-child workspace isolation.

## Goal

When a delegated child hits `stopReason: "length"` and does not reach `task_finished` or `task_block`:

- attempt **one** bounded automatic recovery prompt
- force a decision:
  - continue in smaller concrete steps, or
  - call `task_block` with a workflow-level reason why the child cannot continue
- if recovery still fails:
  - leave the task as a normal **blocked** task with an honest system-generated `blocked_reason`
  - let the commissioner decide whether to `task_unblock` or `task_rollback`
- keep the commissioner at the **workflow/report** level, not implementation level
- avoid inventing a diagnosis such as "the task is too big" when truncation alone does not justify it

## Core semantics

### Child-side meaning

- `task_finished` = the child considers the delegated task complete
- `task_block` = the child cannot continue and must explain **why** at workflow level

Examples of acceptable workflow-level `blocked_reason` values:

- task is too large and should be split
- task contradicts previously agreed requirements/design
- required commissioner input is missing
- technical/tooling issue prevents progress

`task_block` does **not** itself decide whether prior child work is kept or discarded.

### Commissioner-side meaning

The commissioner chooses the next action after a blocked/finished child:

- `task_unblock` = continue the same blocked child line with new guidance/input
- `task_reopen` = continue a previously finished child line because more work is needed
- `task_rollback` = restore the workspace to exactly the state from before `task_delegate` started, stop/forget the child line, and delete the task file
- `task_accept` = accept the child line and delete the task file

This keeps "cannot continue" separate from "what should happen to the workspace and session".

### Truncation meaning

Repeated truncation means only:

- the child failed to reach a checkpoint within the available context budget, even after one bounded recovery attempt

It does **not** prove a specific cause such as "task too big".

The system may recommend:

- split the task into smaller tasks, or
- delegate technical salvage

but must not claim more certainty than it has.

### Rollback meaning

`task_rollback` is a commissioner operation, not a child state.

It is allowed for any still-existing task file, including tasks currently `in_progress`, `blocked`, or `finished`.

After `task_rollback`:

- the workspace must match exactly the state from before `task_delegate` started
- tracked and untracked task-created changes must be gone
- any pre-existing dirty workspace state must be restored exactly
- the task file is deleted
- the child line is a point of no return from the task store's perspective

`task_rollback` does **not** create durable task history. If humans later need to understand why rollback happened, that information lives in chat/session logs, not in the task file.

## Git model

To restore the exact pre-task state, the task must record two different git references:

- `base_sha` = `HEAD` before `task_delegate` starts
- `snapshot_sha` = commit capturing the full pre-task dirty workspace, if the workspace was dirty

This is necessary because restoring only `base_sha` would lose pre-existing dirty changes.

Rollback must therefore restore both:

- branch/worktree state back to `base_sha`
- pre-task dirty workspace from `snapshot_sha` when present

Snapshot commits are internal mechanics only:

- they may include all tracked and untracked workspace changes present before delegation
- they are not user-facing history
- after rollback they may still exist internally in git for a while, but they must be gone from visible branch history and from the workspace

## Plan

### 1. Define task metadata
- [ ] Extend task metadata for rollback handling:
  - [ ] `base_sha`
  - [ ] optional `snapshot_sha`
- [ ] Do **not** add rollback-history fields that outlive task deletion
- [ ] Update task model/read-write code accordingly

### 2. Add git helpers
- [ ] Add helper to read current `HEAD`
- [ ] Add helper to detect whether workspace is dirty
- [ ] Add helper to create pre-task snapshot commit from the full current workspace
- [ ] Decide snapshot-commit message format
- [ ] Add helper to restore tracked files to `base_sha`
- [ ] Add helper to remove untracked files/directories created during the task
- [ ] Add helper to restore pre-task dirty workspace from `snapshot_sha` when present
- [ ] Fail delegation if required snapshot creation fails
- [ ] Do **not** create empty/no-op snapshot commits when the workspace was clean

### 3. Record task start state in `task_delegate`
- [ ] Capture `base_sha` before child attempt starts
- [ ] If the workspace is dirty, create a snapshot commit and record `snapshot_sha`
- [ ] Ensure the recorded data is sufficient to restore the exact pre-task state later

### 4. Add shared truncation-recovery orchestration
- [ ] Centralize child prompting/waiting logic so recovery is not duplicated
- [ ] Detect assistant `message_end` with `stopReason: "length"`
- [ ] Check task is still `in_progress`
- [ ] Send exactly one automatic recovery prompt
- [ ] Ensure no infinite retry loop
- [ ] On repeated truncation/failure, convert the task to a normal blocked task with a system-generated `blocked_reason`
- [ ] Do **not** auto-rollback on truncation failure

### 5. Recovery prompt behavior
- [ ] Prompt instructs child to choose:
  - [ ] continue in smaller concrete steps, or
  - [ ] call `task_block` with a workflow-level reason why it cannot continue
- [ ] Keep wording concise and action-oriented
- [ ] Avoid asking for vague introspection about hidden thinking
- [ ] Do not tell the child to assert unsupported diagnoses such as "task too big" unless the child itself concludes that

### 6. Apply recovery logic in all three entry points
- [ ] `task_delegate`
- [ ] `task_unblock`
- [ ] `task_reopen`

### 7. Add commissioner rollback flow
- [ ] Add commissioner tool `task_rollback`
- [ ] Parameters:
  - [ ] `slug`
- [ ] Allow rollback for any still-existing task file, including `in_progress`, `blocked`, and `finished`
- [ ] If the child line is still running, stop it first
- [ ] Restore the exact pre-task state using `base_sha` and optional `snapshot_sha`
- [ ] Remove tracked changes introduced after task start
- [ ] Remove untracked files/directories introduced after task start
- [ ] Restore pre-task dirty files when `snapshot_sha` exists
- [ ] Delete the task file after successful rollback
- [ ] Make tool result text clear enough to be the surviving chat-level record

### 8. Accept/rollback invariants
- [ ] `task_accept` and `task_rollback` both delete the task file
- [ ] Both are points of no return from the task store's perspective
- [ ] `task_rollback` must fail cleanly when the task file no longer exists
- [ ] Restore must remain impossible once the task file is gone

### 9. Preserve role boundaries
- [ ] Ensure commissioner-facing output never requires code/diff inspection
- [ ] Keep messages workflow-level
- [ ] Require child blocked reasons to stay workflow-level, not implementation-level
- [ ] If technical interpretation is needed, require delegation to technical specialist

### 10. Tests
- [ ] `task_delegate` records `base_sha`
- [ ] Dirty workspace at delegate start creates and records `snapshot_sha`
- [ ] Clean workspace at delegate start does **not** create `snapshot_sha`
- [ ] Delegation fails if required snapshot creation fails
- [ ] `task_rollback` from `blocked` restores exact pre-task state
- [ ] `task_rollback` from `finished` restores exact pre-task state
- [ ] `task_rollback` from `in_progress` stops the child and restores exact pre-task state
- [ ] `task_rollback` removes tracked task changes
- [ ] `task_rollback` removes untracked task files/directories
- [ ] `task_rollback` restores pre-existing dirty workspace changes
- [ ] `task_rollback` deletes the task file
- [ ] One automatic recovery prompt only
- [ ] Recovery works in `task_delegate`
- [ ] Recovery works in `task_unblock`
- [ ] Recovery works in `task_reopen`
- [ ] Second truncation/failure becomes a normal blocked task with honest non-causal reason
- [ ] Truncation failure recommends "split or technical salvage"
- [ ] Missing task file prevents further restore/resume

### 11. Documentation
- [ ] Update the root `README.md` section for the unfolding extension
- [ ] Document one-shot truncation recovery
- [ ] Document `task_block` as "cannot continue" with workflow-level reason
- [ ] Document `task_rollback` semantics
- [ ] Document that truncation failure leaves a normal blocked task for commissioner decision
- [ ] Document git boundary/snapshot handling (`base_sha` + optional `snapshot_sha`)
- [ ] Document that task files are coordination state, not durable history
- [ ] Update affected role docs under `extensions/unfolding/roles/*.md`
- [ ] Document the new commissioner tool set where roles currently mention task tools
- [ ] Document hard constraint: serial child execution only
- [ ] Document open architectural limit: parallel execution needs isolated workspaces

## Explicit architectural limit
- [ ] State clearly that current design assumes **serialized** child execution
- [ ] State clearly that parallel child execution requires per-child workspace isolation
