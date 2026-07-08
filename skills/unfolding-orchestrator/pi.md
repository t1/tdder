# Unfolding Orchestrator — pi Bindings

## Tools

| Abstract action          | Tool                                                 |
|--------------------------|------------------------------------------------------|
| Spawn an agent           | `task_delegate(role, slug, body)`                    |
| Continue current agent   | `task_continue()`                                    |
| Resume a blocked agent   | `task_unblock(slug, resume_message)`                 |
| Block waiting for Sensei | `task_block(reason)` — on your own orchestrator task |
| Read task state          | `task_list` / `task_read` (orchestrator diagnostics) |

There is no team, no shutdown, no idle notification. When a `task_delegate`
or `task_continue` call returns, the direct delegate has reached a visible
outcome (`finished`, `blocked`, or an in-progress line that was reconnected and surfaced).
The Orchestrator only sees the top-level PO delegation — all deeper nesting
(PO → UX Designer, Architect → Coder, etc.) is handled by the agents themselves.

## Startup

```
task_delegate(role="po", slug="po-<feature-slug>", body="<Sensei guidance>")
```

If the workspace is genuinely empty, include that explicitly in the body,
e.g. that there is no existing code or tech stack to explore and the PO should start
with `docs/product.md`, ATs, rules, indexes, and any needed DMDs directly.

If resuming, first prefer the live task mechanism over documentation.

- If the Orchestrator already has one direct delegate line, call `task_continue`.
- If there is no direct delegate line, create a new top-level PO task with `task_delegate`.
- If orchestrator diagnostics reveal any invalid top-level task tree that is not Orchestrator → PO, treat that as corrupted state and stop honestly.

`task_list` and `task_read` remain available to you as orchestrator diagnostics. Use them when the Sensei asks you to
investigate workflow issues, and also when you yourself detect an obvious anomaly in the live task tree (for example an
unclear blockage, an unresolved finished top-level PO line, or inconsistent task metadata).

Do **not** spawn Architect, Coder, or any other non-PO role directly from the Orchestrator.

## Handle Blocked Tasks

Normal ADR/DMD questions are **not** your job anymore:

- the PO asks DMD questions directly with `ask_sensei`
- the Architect asks ADR questions directly with `ask_sensei`

Do **not** read ADR/DMD files just to extract question text, and do **not** relay
normal decision questions through the PO.

When the top-level PO task returns `blocked`, treat it as a real commissioner issue:

1. Read the blocked reason
2. If the issue is environmental or operational (e.g. service not running,
   Playwright issue, missing local setup), fix it directly
3. If the issue is malformed scope/input, unblock with a short corrective message
4. If the issue cannot honestly be resolved by you, report that clearly instead of
   fabricating an answer

Only after resolving the commissioner issue should you call `task_unblock`.

You may also investigate obvious workflow anomalies proactively with `task_list` / `task_read`, but only for live
coordination diagnosis. Do not use them as a pretext to supervise lower roles or to inspect implementation artifacts.

## Sensei Guidance (unsolicited)

When the Sensei provides guidance outside a DMD/ADR cycle, pass it into the
currently running PO line. If that line is blocked, use `task_unblock`; if it was merely interrupted while still active,
resume with `task_continue` after ensuring the PO will see the guidance in the resumed context.

Prefix the guidance:

> **Sensei guidance:** \<the text\>
