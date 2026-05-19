# Unfolding Specs — Process Overview

**TDD all the way up** — Test-as-a-Spec from top to bottom. Specify only the next
minimal thing by writing a test, pass the requirement down, then see if the
solution produced by the lower level passes the test. Three nested loops at
different abstraction levels (hence Acceptance Tests, System Tests, and Unit
Tests — similar to the notorious [V-Model](https://en.wikipedia.org/wiki/V-model), but
iterating baby steps instead of heavy, supposedly "complete" specs).

Specs live in two tiers:
- **Business tier** — *what* the product does: Acceptance Tests and Business Rules
  are the primary spec; Feature Design Decisions (FDDs) capture decisions and
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

Roles are implemented as **Claude Code agents** (`.claude/agents/unfolding-*.md`).
The Orchestrator manages the team, spawning agents on demand. Agents communicate
directly with their collaborators via SendMessage and coordinate work through the
shared task list.

| Role             | Agent Definition                | Responsibility                                                                             |
|------------------|---------------------------------|--------------------------------------------------------------------------------------------|
| **Orchestrator** | skill: `unfolding-orchestrator` | Spawns agents, relays Sensei questions, proxies Playwright actions, owns `docs/state.yaml` |
| **PO**           | `unfolding-po.md`               | Decomposes Features, writes Acceptance Tests and Business Rules, proposes FDDs             |
| **Architect**    | `unfolding-architect.md`        | Decomposes Features into Tasks, writes System Tests, proposes ADRs                         |
| **Coder**        | `unfolding-coder.md`            | Implements Tasks using TDD (Red-Green-Refactor)                                            |
| **UX Designer**  | `unfolding-ux-designer.md`      | User's advocate; challenges Feature specs, designs tech-agnostic UX                        |
| **API Designer** | `unfolding-api-designer.md`     | Consumer's advocate; designs customer-facing integration APIs (API-first)                  |
| **UI Expert**    | `unfolding-ui-expert.md`        | Maps UX components to concrete technology                                                  |
| **Process Dev**  | skill: `unfolding-specs`        | Meta-role: develops the process itself, using the product as a test bed                    |

The Orchestrator is a **skill only** (no agent definition) — it runs in the
current session via `/unfold` or by loading the `unfolding-orchestrator` skill.

## Communication Model

### Task List (work coordination)

Agents create tasks with prefixed subjects to route work:

```
[PO] Define Feature ──> PO works
  ├── [FDD] Decision ──> Orchestrator relays to Sensei
  ├── [UX] Design ──> UX Designer works <──messages──> PO
  ├── [API] Design ──> API Designer works <──messages──> PO
  └── [ARCH] Implement Feature ──> Architect works
        ├── [ADR] Decision ──> Orchestrator relays to Sensei
        ├── [UX-MAP] Map component ──> UI Expert works <──messages──> Architect
        └── [CODE] Implement Task ──> Coder works <──messages──> Architect
              └── [UX-REVIEW] Review UX ──> UX Designer reviews in browser <──messages──> PO
                    └── [AT] Verify ──> PO runs all ATs and business rule tests
```

### Direct Messaging (peer collaboration)

Agents message their primary collaborators directly:

- PO <-> UX Designer, API Designer
- Architect <-> Coder, UI Expert
- Architect -> PO (AT verification)
- Any agent -> Orchestrator (ensure-active requests, Sensei escalation only)

**Spawn-first rule:** Before an agent sends the first message in a new
commissioning cycle, it must ask the Orchestrator: "Please ensure [role]
is active for task #X." The Orchestrator spawns if needed or confirms the
agent is active. This prevents silent message loss when a target agent
has been shut down. Subsequent messages in the same cycle go directly.

The Orchestrator does NOT relay routine communication.

## Artifact Ownership

| Artifact                      | Location              | Owned by     |
|-------------------------------|-----------------------|--------------|
| Product brief                 | `docs/product.md`     | PO           |
| Feature Design Decisions      | `docs/fdd/`           | PO           |
| Architecture Decision Records | `docs/adr/`           | Architect    |
| Acceptance Tests              | `docs/ats/`           | PO (private) |
| AT index (incl. Roles)        | `docs/ats/INDEX.md`   | PO (shared)  |
| AT step catalog               | `docs/ats/steps/`     | PO (shared)  |
| Business Rules                | `docs/rules/`         | PO (shared)  |
| Business Rules index          | `docs/rules/INDEX.md` | PO (shared)  |
| Business Rule step catalog    | `docs/rules/steps/`   | PO (shared)  |
| UX component catalog          | `docs/ux/`            | UX Designer  |
| UX tech mappings              | `docs/ux-mapping/`    | Architect    |
| API resource catalog          | `docs/api/`           | API Designer |
| Process state                 | `docs/state.yaml`     | Orchestrator |

## Commits

[Conventional Commits](https://www.conventionalcommits.org/) format with
the Feature slug as scope and a role suffix:

- **PO** commits plan artifacts: `feat(<slug>:plan): <description>`
- **Architect** commits implementation: `feat(<slug>:code): <description>`

The PO assigns the slug when defining a Feature (e.g., `register-owner`).
AT files in `docs/ats/` use the slug as file name; business rules in
`docs/rules/` are named by domain concept.

## Entry Points

- `/unfold` — resumes from `docs/state.yaml`
- `/unfold <guidance>` — passes free-text as Sensei guidance to the first agent spawned
