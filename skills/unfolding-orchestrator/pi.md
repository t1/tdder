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

If the workspace is genuinely empty, include that explicitly in the body, e.g. that there is no existing code or tech stack to explore and the PO should start with `docs/product.md`, ATs, rules, indexes, and any needed DMDs directly.

If resuming, create a task for the appropriate role per the phase table in
`SKILL.md` and call `task_delegate` with that role.

## Relay Sensei Questions

When the PO's `task_delegate` returns `blocked` and the reason references a
`[DMD]` task, or the Architect's delegation surfaces an `[ADR]`:

1. Read the referenced DMD/ADR file to extract the question text — do not
   interpret or reason about the content
2. Present each question verbatim to the Sensei, one at a time, using the
   `ask_sensei` tool:
   - pass `options` for multiple-choice questions
   - omit `options` for free-text questions
   - set `freeText: true` if the question has options plus a free-text override
3. Call `task_unblock(slug, answer)` on the **PO task** (not the Architect or
   any deeper task) with the Sensei's answer verbatim. The PO relays it down
   the chain via its own `task_unblock` call.

If the blocked reason is not a DMD/ADR (e.g. a service not running, a
Playwright issue), handle it directly — start the service, fix the
environment — then call `task_unblock`.

## Sensei Guidance (unsolicited)

When the Sensei provides guidance outside a DMD/ADR cycle, call
`task_unblock` on the currently running PO task with the guidance prefixed:

> **Sensei guidance:** \<the text\>
