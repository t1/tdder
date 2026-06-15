# Unfolding Orchestrator — pi Bindings

## Tools

| Abstract action | Tool |
|---|---|
| Spawn an agent | `task_delegate(role, slug, body)` |
| Resume a blocked agent | `task_unblock(slug, resume_message)` |
| Block waiting for Sensei | `task_block(reason)` — on your own orchestrator task |
| Read task state | `task_list` / `task_read` |

There is no team, no shutdown, no idle notification. When a `task_delegate`
call returns, the sub-agent has either finished (`finished`) or blocked
(`blocked`). The Orchestrator only sees the top-level PO delegation — all
deeper nesting (PO → UX Designer, Architect → Coder, etc.) is handled by
the agents themselves.

## Startup

```
task_delegate(role="po", slug="po-<feature-slug>", body="<Sensei guidance>")
```

If resuming, create a task for the appropriate role per the phase table in
`SKILL.md` and call `task_delegate` with that role.

## Relay Sensei Questions

When the PO's `task_delegate` returns `blocked` and the reason references a
`[DMD]` task, or the Architect's delegation surfaces an `[ADR]`:

1. Read the draft file
2. Present the question using `ctx.ui.select()` for multiple-choice options,
   `ctx.ui.input()` for free-text, or both in sequence if the DMD/ADR has
   options plus a free-text override
3. Call `task_unblock(slug, answer)` with the Sensei's answer verbatim

If the blocked reason is not a DMD/ADR (e.g. a service not running, a
Playwright issue), handle it directly — start the service, fix the
environment — then call `task_unblock`.

## Sensei Guidance (unsolicited)

When the Sensei provides guidance outside a DMD/ADR cycle, call
`task_unblock` on the currently running PO task with the guidance prefixed:

> **Sensei guidance:** \<the text\>
