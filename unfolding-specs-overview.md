# Unfolding Specs — Process Overview

**TDD all the way up** — Test-as-a-Spec from top to bottom. Specify only the next
minimal thing by writing a test, pass the requirement down, then see if the
solution produced by the lower level passes the test. Three nested loops at
different abstraction levels (hence Acceptance Tests, System Tests, and Unit
Tests — similar to the notorious [V-Model](https://en.wikipedia.org/wiki/V-model), but
iterating baby steps instead of heavy, supposedly "complete" specs).

Specs live in two tiers:

- **Business tier** — *what* the product does: Acceptance Tests and Business Rules
  are the primary spec; Domain Model Decisions (DMDs) capture decisions and
  trade-offs that tests alone can't express, including alternatives considered
  and why they were rejected.
- **Technical tier** — *how* it is built: System Tests and code are the primary
  spec; Architecture Decision Records (ADRs) serve the same purpose for
  technical decisions.

Humans are **Senseis**: they answer questions and give guidance, not drive
execution. Their input should trigger thinking and discussion, not blind
compliance.

## Terms

* **Release** — a version worth delivering to Customers, starting with an MVP or
  alpha/beta. Use [semver](https://semver.org); for UIs, a breaking change is
  something that forces users to relearn what they are accustomed to.
* **Feature** — a bugfix or new capability visible on the outside: Frontend, MCP,
  API, etc. May be decomposed into Sub-Features.
* **Task** — technical decomposition of a Feature, possibly into Sub-Tasks.
* **Customer** — someone using the product.
* **Sensei** — human support to an agent. Provides guardrails, observes agent
  performance, intervenes when necessary, and improves guardrails so the agent
  learns from mistakes. Also directly prompts the PO with creative ideas.

## Architecture

Unfolding Specs is defined in terms of **roles** and **handoffs**, not in terms
of one specific agent runtime.

Each role has a role definition (prompt/instructions), reads and writes its own
artifacts, and hands work to the next role through the shared work queue plus a
runtime-specific handoff mechanism.

| Role             | Role Definition / Runtime Hook         | Responsibility                                                                                    |
|------------------|----------------------------------------|---------------------------------------------------------------------------------------------------|
| **Orchestrator** | skill / command / extension entrypoint | Dispatches role runs, mediates runtime-specific Sensei interaction, proxies restricted actions, and owns the top-level PO line |
| **PO**           | `unfolding-po.md`                      | Decomposes Features, writes Acceptance Tests and Business Rules, proposes DMDs                    |
| **Architect**    | `unfolding-architect.md`               | Decomposes Features into Tasks, writes System Tests, proposes ADRs                                |
| **Coder**        | `unfolding-coder.md`                   | Implements Tasks using TDD (Red-Green-Refactor)                                                   |
| **UX Designer**  | `unfolding-ux-designer.md`             | User's advocate; challenges Feature specs, designs tech-agnostic UX                               |
| **API Designer** | `unfolding-api-designer.md`            | Consumer's advocate; designs customer-facing integration APIs (API-first)                         |
| **UI Expert**    | `unfolding-ui-expert.md`               | Maps UX components to concrete technology                                                         |
| **Process Dev**  | skill: `unfolding-specs`               | Meta-role: develops the process itself, using the product as a test bed                           |

The exact runtime mechanics differ by platform:

- In **Claude Code**, role runs are typically implemented as spawned agents plus
  direct messages.
- In **pi**, role runs may be implemented as subagents, dedicated sessions, or
  extension-managed dispatch.

The process itself should not depend on which runtime happens to provide those
mechanics.

## Runtime-Neutral Terms

These terms describe the process independently of Claude Code or pi:

- **Role definition** — the instructions that define one role's responsibilities,
  boundaries, and process.
- **Role run** — one active execution of a role against a specific task or
  verification step.
- **Dispatcher** — the runtime component that resumes or starts the next role
  run, keeps global process state, and mediates Sensei interaction.
- **Shared work queue** — the durable list of work items (`[PO]`, `[ARCH]`,
  `[CODE]`, `[AT]`, `[DMD]`, `[ADR]`, ...).
- **Handoff** — a directed transfer of responsibility from one role to another.
  The handoff may be implemented as direct messaging, durable files, or runtime
  routing.
- **Activation** — making a target role able to receive its next handoff.
  Depending on runtime this may mean spawning an agent, resuming a session, or
  invoking a subagent.
- **Sensei escalation** — any question that requires human judgment and must reach the human,
  either directly from the owning role when the runtime supports it or via the dispatcher when it does not.
- **Process state** — the runtime-specific live checkpoint that allows `/unfold` to resume.

## Runtime Mapping

| Runtime-neutral term  | Claude Code term / mechanism                        | pi term / mechanism                                                            |
|-----------------------|-----------------------------------------------------|--------------------------------------------------------------------------------|
| **Role definition**   | Agent definition in `.claude/agents/unfolding-*.md` | Agent/role prompt used by an extension, subagent, or dedicated session         |
| **Role run**          | Spawned agent instance                              | Subagent run or dedicated pi session                                           |
| **Dispatcher**        | Orchestrator skill in the current session           | `/unfold` command and/or extension in the current session                      |
| **Shared work queue** | Shared task list                                    | Shared task/state files or extension-managed queue                             |
| **Handoff**           | `SendMessage` plus task references                  | Durable task/artifact update plus extension-routed or session-directed message |
| **Activation**        | `Agent(...)` / ensure-active                        | Start or resume the target role session/subagent                               |
| **Sensei escalation** | Runtime-dependent: often orchestrator-mediated      | Runtime-dependent: direct role questioning or orchestrator/extension-mediated   |
| **Process state**     | Runtime-specific workflow checkpoint                | Runtime-specific workflow checkpoint                                            |

## Communication Model

### Shared Work Queue (work coordination)

Roles create work items with prefixed subjects to route work:

```
[PO] Define Feature ──> PO works
  ├── [DMD] Decision ──> Sensei answer reached via runtime-specific path
  ├── [UX] Design ──> UX Designer works <──handoff──> PO
  ├── [API] Design ──> API Designer works <──handoff──> PO
  └── [ARCH] Implement Feature ──> Architect works
        ├── [ADR] Decision ──> Sensei answer reached via runtime-specific path
        ├── [UX-MAP] Map component ──> UI Expert works <──handoff──> Architect
        └── [CODE] Implement Task ──> Coder works <──handoff──> Architect
              └── [UX-REVIEW] Review UX ──> UX Designer reviews in browser <──handoff──> PO
                    └── [AT] Verify ──> PO runs all ATs and business rule tests
```

### Directed Handoffs (peer collaboration)

Primary collaboration paths are:

- PO <-> UX Designer, API Designer
- Architect <-> Coder, UI Expert
- Architect -> PO (AT verification)
- Any role -> Dispatcher (activation requests, plus Sensei escalation when the runtime does not support direct role questioning)

The process requires that a handoff reaches a role that is ready to receive it.
How that is achieved is runtime-specific:

- **Claude Code:** the sender typically asks the Dispatcher to ensure the target
  role is active, then messages that role directly.
- **pi:** the Dispatcher may resume or invoke the target role and pass along the
  task context through durable files, a routed message, or session state.

The important rule is not "use direct messages"; it is:

> **Do not assume the target role is ready until the Dispatcher/runtime has made
> it ready.**

The Dispatcher should avoid relaying routine collaboration when the runtime can
support direct handoff. The same applies to Sensei questions: if the runtime supports
direct role questioning, the owning role should ask directly; otherwise the dispatcher
mediates. The process remains valid even when a runtime needs more mediation.

## Artifact Ownership

| Artifact                      | Location              | Owned by     |
|-------------------------------|-----------------------|--------------|
| Product brief                 | `docs/product.md`     | PO           |
| Domain Model Decisions        | `docs/dmd/`           | PO           |
| Architecture Decision Records | `docs/adr/`           | Architect    |
| Acceptance Tests              | `docs/ats/`           | PO (private) |
| AT index (incl. Roles)        | `docs/ats/INDEX.md`   | PO (shared)  |
| AT step catalog               | `docs/ats/STEPS.md`   | PO (shared)  |
| Business Rules                | `docs/rules/`         | PO (shared)  |
| Business Rules index          | `docs/rules/INDEX.md` | PO (shared)  |
| Business Rule step catalog    | `docs/rules/STEPS.md` | PO (shared)  |
| UX component catalog          | `docs/ux/`            | UX Designer  |
| UX tech mappings              | `docs/ux-mapping/`    | Architect    |
| API resource catalog          | `docs/api/`           | API Designer |
| Live workflow state           | Runtime-specific     | Orchestrator |

## Commits

[Conventional Commits](https://www.conventionalcommits.org/) format with
the Feature slug as scope and a role suffix:

- **PO** commits plan artifacts: `feat(<slug>:plan): <description>`
- **Architect** commits implementation: `feat(<slug>:code): <description>`

The PO assigns the slug when defining a Feature (e.g., `register-owner`).
AT files in `docs/ats/` use the slug as file name; business rules in
`docs/rules/` are named by domain concept.

## Entry Points

- `/unfold` — resumes from the runtime-specific live workflow checkpoint
- `/unfold <guidance>` — passes free-text as Sensei guidance to the first role run dispatched
