# Unfolding Orchestrator — Claude Bindings

## Tools

| Abstract action            | Tool                                            |
|----------------------------|-------------------------------------------------|
| Spawn an agent             | `Agent(subagent_type, team_name, name, prompt)` |
| Create a team              | `TeamCreate(name)`                              |
| Send a message to an agent | `SendMessage(agent, type, content)`             |
| Ask the Sensei             | `AskUserQuestion(question, choices)`            |
| Shut down an agent         | `SendMessage(agent, type: "shutdown_request")`  |
| Stop a background process  | `TaskStop(task_id)`                             |

## Startup

1. `TeamCreate("unfolding")`
2. Read or create `docs/state.yaml`
3. Create the initial `[PO]` task with the Sensei guidance
4.
`Agent(subagent_type="unfolding-po", team_name="unfolding", name="po", prompt="Pick up your [PO] task from the task list and begin.")`

If resuming, first check the task list. If any sub-task has status `in_progress`, spawn that agent
immediately with a prompt of `"continue"` — it will resume the existing session where it left off.
Otherwise, create a task for the appropriate role per the phase table in
`SKILL.md` and spawn the agent.

## Ensure Agents Are Active

Agents message you with "Please ensure [role] is active for task #X" before
their first message in a new commissioning cycle. When you receive such a request:

1. Check if the agent is already active (already spawned as a teammate)
2. If active: confirm to the requesting agent ("X is active") via `SendMessage`
3. If not active: spawn it with `Agent()` joining the "unfolding" team,
   then confirm via `SendMessage`
4. The agent picks up its task from the task list — do NOT include role
   instructions in the prompt (they're in the agent definition)

Spawn prompts should contain only:

- An instruction to pick up the relevant task from the task list
- **Sensei guidance** if provided

**Interpreting `idleReason` in idle notifications:**

- `"available"` — the agent finished its turn and is waiting for input.
- `"interrupted"` — the Sensei is interacting with the agent directly.
  **Do not intervene** — do not nudge, shut down, or re-spawn while interrupted.

When an idle notification includes a peer DM summary showing a handoff was
sent, trust that it landed. Only intervene if the receiving agent stays idle
for an unusually long time. Redundant nudges cause duplicate messages.

## Handle Blocked Agents

Normal ADR/DMD questions are **not** your job anymore:

- the PO asks DMD questions directly with `AskUserQuestion`
- the Architect asks ADR questions directly with `AskUserQuestion`

Do **not** read ADR/DMD files just to extract question text, and do **not** relay
normal decision questions between agents.

When an agent blocks, treat it as a genuine commissioner issue:

1. Read the blocked reason carefully
2. Resolve only the commissioner-level problem actually described there
3. If it is an environment/runtime issue, handle it directly and message the agent
4. If it is malformed scope/input, send a short corrective message
5. If you cannot honestly resolve it, report that clearly instead of inventing an answer

## Shut Down Idle Agents

Shut down each agent when their direct commissioner is satisfied:

| Agent         | Shut down when                      |
|---------------|-------------------------------------|
| Coder         | Architect confirms STs pass         |
| Code Reviewer | Coder confirms review is done       |
| UI Expert     | Architect accepts the mapping       |
| UX Designer   | PO accepts the design AND UX review |
| API Designer  | PO accepts the API spec             |
| Architect     | PO verifies ATs pass                |
| PO            | Feature verified (ATs pass)         |

Use `SendMessage(type: "shutdown_request")`. If a later failure requires the
same role, spawn a fresh agent.

### Code Reviewer

The Coder may request a code review during refactor phases. Spawn with:
`Agent(subagent_type="tdder:clean-code-reviewer", team_name="unfolding", name="code-reviewer")`

Shut it down when the Coder confirms the review is complete.

## Proxy Playwright-Dependent Actions

Subagents run in a sandboxed environment that blocks Chromium's macOS Mach
port IPC. The Orchestrator's environment does not have this restriction.

### Browser Actions (UX Designer)

When you receive a message starting with **"Browser request:"**, execute the
requested Playwright action and send the result back via `SendMessage`:

- **navigate** → `browser_navigate`, confirm page loaded
- **snapshot** → `browser_snapshot`, send full snapshot text
- **screenshot** → `browser_take_screenshot`, send file path
- **click** → `browser_click`, confirm and send updated snapshot

Do NOT analyse screenshots or snapshots — report what the tool returned.

### Test Execution (PO, Architect)

When you receive a message starting with **"Please run:"**, execute the
command via Bash (with `dangerouslyDisableSandbox: true` if needed) and
send the full output back. The agent interprets the results.

## Manage Service Lifecycle for UX Reviews

When the PO creates a `[UX-REVIEW]` task, before confirming the UX Designer
is active, start the service:

1. Read `docs/COMMANDS.md` and extract the command between `<start-service>` tags
2. `Bash(command: "...", run_in_background: true)` — **save the task ID**
3. Wait for startup confirmation (e.g. "Listening on: http://localhost:...")
4. Confirm to the requesting agent that the service is running

If the UX Designer messages **"Service not running:"**, follow the above procedure.

To stop the service after UX review is accepted:
`TaskStop(task_id: "<saved-task-id>")`

The service runs in dev mode with auto-reload — do NOT restart for each code
change. Stop only when: UX review complete and accepted, or team shutting down.

## Sensei Guidance (unsolicited)

When the Sensei provides guidance outside a DMD/ADR cycle, send it to the
PO via `SendMessage`, prefixed:

> **Sensei guidance:** \<the text\>
