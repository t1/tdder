# Unfolding Orchestrator — pi Bindings

## Tools

| Abstract action          | Tool                                                 |
|--------------------------|------------------------------------------------------|
| Spawn an agent           | `task_delegate(role, slug, body)`                    |
| Resume a blocked agent   | `task_unblock(slug, resume_message)`                 |
| Block waiting for Sensei | `task_block(reason)` — on your own orchestrator task |
| Read task state          | `task_list` / `task_read`                            |

There is no team, no shutdown, no idle notification. When a `task_delegate`
call returns, the sub-agent has either finished (`finished`) or blocked
(`blocked`). The Orchestrator only sees the top-level PO delegation — all
deeper nesting (PO → UX Designer, Architect → Coder, etc.) is handled by
the agents themselves.

## Startup

```
task_delegate(role="po", slug="po-<feature-slug>", body="<Sensei guidance>")
```

If the workspace is genuinely empty, include that explicitly in the body,
e.g. that there is no existing code or tech stack to explore and the PO should start
with `docs/product.md`, ATs, rules, indexes, and any needed DMDs directly.

If resuming, first call `task_list`. If any sub-task has status `in_progress`, call `task_delegate`
on it immediately with the original body — it will resume the existing session where it left off.
Otherwise, create a task for the appropriate role per the phase table in
`SKILL.md` and call `task_delegate` with that role.

## Handle Blocked Tasks

Normal ADR/DMD questions are **not** your job anymore:

- the PO asks DMD questions directly with `ask_sensei`
- the Architect asks ADR questions directly with `ask_sensei`

Do **not** read ADR/DMD files just to extract question text, and do **not** relay
normal decision questions through the PO.

When a top-level task returns `blocked`, treat it as a real commissioner issue:

1. Read the blocked reason
2. If the issue is environmental or operational (e.g. service not running,
   Playwright issue, missing local setup), fix it directly
3. If the issue is malformed scope/input, unblock with a short corrective message
4. If the issue cannot honestly be resolved by you, report that clearly instead of
   fabricating an answer

Only after resolving the commissioner issue should you call `task_unblock`.

## Sensei Guidance (unsolicited)

When the Sensei provides guidance outside a DMD/ADR cycle, call
`task_unblock` on the currently running PO task with the guidance prefixed:

> **Sensei guidance:** \<the text\>
