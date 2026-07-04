# Plan: Role-Level Tool Restrictions in Unfolding Sub-Sessions

## Motivation

Sub-sessions spawned by the unfolding extension currently have the same tool set
as the parent session, including `bash`. `bash` is an escape hatch — it can
bypass every isolation rule enforced only by the role prompt (e.g. "don't read
`.feature` files"). Restricting tools structurally makes role boundaries
enforceable and agent behaviour auditable.

## Mechanism

The unfolding extension already uses `createAgentSession()` to spawn child
sessions. The SDK supports:

- **`tools: [...]`** — activates only the named tools; everything else is
  excluded automatically, including tools from unknown or future extensions.
  This is an allowlist, not a denylist — the safe default.
- **`tool_call` event handler** — intercepts tool calls before execution;
  returning `{ block: true }` prevents the call. Used for *restricting* a tool
  (e.g. allowing `read` only on certain paths) rather than removing it entirely.

The role file (e.g. `extensions/unfolding/roles/po.md`) is the natural place to
declare which tools are allowed and which path restrictions apply. The unfolding
extension reads this preamble when spawning the child session and configures
`createAgentSession()` accordingly.

## PoC: Restrict the PO Role

### Why PO

The PO role file explicitly forbids filesystem exploration (`bash`, `find`, etc.).
`bash` is available but never legitimate for the PO — making it an easy,
high-confidence first target. If the PoC reveals unexpected friction, it shows up
in a role where the expected impact is minimal.

### PO tool allowlist

Expressed as an allowlist (everything not listed is excluded, including tools
from unknown or future extensions):

| Tool | Notes |
|------|-------|
| `read` | Reads product artifacts, step catalogs, COMMANDS.md |
| `write` | Creates DMDs, ATs, business rules, indexes |
| `edit` | Updates existing artifacts |
| `ask_sensei` | DMD questions |
| `task_delegate` | Commissions Architect, designers |
| `task_finished` | Signals completion |
| `task_block` | Signals blocker |
| `task_unblock` | Resumes blocked sub-agent |
| `task_reopen` | Reopens finished sub-agent |
| `task_rollback` | Discards sub-agent |
| `task_accept` | Accepts finished sub-agent |
| `task_read` | Reads task files |
| `task_list` | Lists tasks |
| `maven_run` | AT/rule verification (step 11) |

`read` needs no path restriction for the PoC — the PO legitimately reads across
`docs/` and the workspace. Path-level `read` restrictions are a later refinement.

### Implementation steps

1. [x] Add a `tools:` preamble section to `extensions/unfolding/roles/po.md`
   declaring the allowlist above.
2. [x] Update the unfolding extension to parse the preamble and pass it as
   `tools: [...]` to `createAgentSession()` for PO sessions.
3. [x] Smoke-test: run the unfolding extension with a PO task and confirm that a
   `bash` call is rejected, while `maven_run` and `read` work normally.
4. [x] Add a test to the extension's test suite asserting that PO sessions use
   the expected tool allowlist.

## Open Tasks (Other Roles)

Each role below needs its own tool audit before restrictions are applied.
The PoC must be working first.

- [ ] **Architect** — needs `read`, `write`, `edit`, `maven_run`, task tools,
  `ask_sensei`. No `bash` — all build/test/search operations have dedicated
  tools (`maven_run`, `idea_*`, `jdtls_*`). `bash` is an escape hatch, not a
  legitimate need. Path restriction: `read` blocked on `docs/ats/*.feature`.
- [ ] **Coder** — needs `read`, `write`, `edit`, `maven_run`, `ask_sensei`,
  `task_finished`, `task_block`. No `bash` — same rationale as Architect.
  No task management tools beyond finishing and blocking (the Coder never
  delegates).
- [ ] **UX Designer** — mostly reads `docs/ux/`, writes component files.
  Likely no `bash` or `maven_run` needed.
- [ ] **API Designer** — reads `docs/api/`, writes resource files.
  Likely no `bash` or `maven_run` needed.
- [ ] **UI Expert** — TBD.
- [ ] **Dynamically registered tools** — `idea_*`, `jdtls_*`, and `quarkus_*` tools
  are registered at startup by connecting to a running IDE/LSP/MCP server, so their
  names are not statically known. Roles that need them (Architect, Coder) must either
  snapshot the live tool list at spawn time, or the preamble format must support
  wildcards (e.g. `idea_*`) that the unfolding extension resolves against the active
  tool registry before passing to `createAgentSession()`.
- [ ] **Path-level `read` restrictions** — once per-role allowlists are stable,
  add `tool_call` interception to enforce isolation rules structurally
  (e.g. Architect cannot read `docs/ats/*.feature`).
- [x] **Shared anti-workaround preamble** — inject a short rule for all roles
  via the unfolding extension (not per-role prose), so it cannot be accidentally
  omitted from a new role:
  > If achieving a goal requires combining tools in a way that isn't their stated
  > purpose, stop and use `task_block` or `ask_sensei` rather than improvising.
  This targets creative tool combinations (e.g. writing a test that reads a
  forbidden file and parsing its output from `maven_run`) without relying on the
  LLM's self-assessment of whether something is "obvious".
