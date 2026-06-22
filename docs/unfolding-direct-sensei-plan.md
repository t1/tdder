# Unfolding direct Sensei questioning plan

Status: in progress

## Goal

Switch the **pi unfolding runtime** from orchestrator-relayed ADR/DMD questioning to direct role questioning:

- Architect asks ADR questions directly via `ask_sensei`
- PO asks DMD questions directly via `ask_sensei`
- Questions are asked one at a time
- The orchestrator no longer relays normal ADR/DMD questions in the pi runtime

## Execution checklist

- [x] **1. Define the target interaction policy**
  - Decide and document the new rule:
    - Architect asks ADR questions directly via `ask_sensei`
    - PO asks DMD questions directly via `ask_sensei`
    - Orchestrator no longer relays ADR/DMD questions in the normal path
  - Clarify whether orchestrator keeps any fallback relay role at all, or none

- [x] **2. Audit current role prompts and docs for relay assumptions**
  - Inspect and list every place that still assumes:
    - orchestrator reads ADR/DMD files to extract questions
    - roles block and wait for orchestrator relay
    - “one-at-a-time” questioning is orchestrator-owned
  - Expected files include at least:
    - `skills/unfolding-orchestrator/SKILL.md`
    - `skills/unfolding-orchestrator/pi.md`
    - `skills/unfolding-orchestrator/claude.md`
    - `extensions/unfolding/roles/architect.md`
    - `extensions/unfolding/roles/po.md`

- [x] **3. Design the new blocking/resume protocol for direct questioning**
  - Define what happens after a role asks Sensei directly:
    - if answered: role continues immediately
    - if cancelled/no answer: role decides whether to block or proceed conservatively
  - Remove the old assumption that ADR/DMD questions must be surfaced through `task_block`
  - Keep `task_block` only for genuine commissioner action, not normal human Q&A

- [x] **4. Reconcile batching semantics before editing prompts**
  - Replace the contradictory “batch when possible” guidance with something executable
  - Proposed rule:
    - roles may identify multiple open decisions
    - but must ask **one question at a time**
    - and must not ask dependent questions before earlier answers land
  - Apply this consistently for both ADRs and DMDs

- [x] **5. Implement direct `ask_sensei` usage in child-role guidance**
  - Update Architect guidance to ask ADR questions directly
  - Update PO guidance to ask DMD questions directly
  - Be explicit that questions must be relayed verbatim where applicable, without role reinterpretation
  - Remove instructions that tell those roles to block so the orchestrator can ask instead

- [x] **6. Simplify orchestrator guidance**
  - Remove the ADR/DMD relay workflow from orchestrator docs
  - Remove instructions to read ADR/DMD files just to extract question text
  - Keep orchestrator focused on coordination, delegation, and task lifecycle only

- [x] **7. Verify extension/runtime support matches the new process**
  - Confirm `ask_sensei` is available and working in delegated child sessions for both Architect and PO paths
  - Confirm the root-session proxy behavior still works after resume/reopen/unblock flows
  - Confirm no commissioner-only tools leak into child sessions

- [x] **8. Add/adjust automated tests**
  - Add tests for child Architect direct questioning
  - Add tests for child PO direct questioning
  - Add tests covering resumed child sessions still being able to use proxied `ask_sensei`
  - Update structural tests that currently encode old relay assumptions

- [x] **9. Run validation**
  - Run `npm run sync-extensions`
  - Run `npm --prefix extensions/unfolding test`
  - If needed, run a focused real pi TUI manual probe for:
    - Architect direct ADR questioning
    - PO direct DMD questioning

- [x] **10. Review for semantic leftovers**
  - Check for stale wording like:
    - “ask the orchestrator to relay”
    - “read the referenced ADR/DMD to extract the question”
    - “block for Sensei decision” in normal direct-question flows
  - Check both skill and extension-role variants stay aligned where behavior is shared

- [x] **11. Commit the change cleanly**
  - Commit only the intended direct-questioning/process updates
  - Keep the commit message short, single line

## Acceptance criteria

- [x] Architect can ask ADR questions directly in a delegated session
- [x] PO can ask DMD questions directly in a delegated session
- [x] Questions are asked one at a time
- [x] Dependent decisions are not blindly batched
- [x] Orchestrator no longer needs to read ADR/DMD files for relay
- [x] Normal ADR/DMD questioning no longer relies on `task_block`
- [x] Child sessions do not expose `task_list` / `task_read`
- [x] Tests pass
- [ ] Real pi TUI probe works for both Architect and PO flows
  - skipped by user for the PO flow; only Architect was manually proven in pi TUI

## Policy decisions locked

- In the **pi unfolding runtime**, direct questioning is now the normal path:
  - Architect asks ADR questions directly with `ask_sensei`
  - PO asks DMD questions directly with `ask_sensei`
- The Architect must not self-approve ADRs or continue implementation past an unresolved ADR decision point
- The PO should not inspect or reason about ADR artifacts at all; technical decision artifacts stay outside PO context
- In the pi runtime, the Orchestrator no longer relays normal ADR/DMD questions and no longer reads ADR/DMD files to extract question text
- `task_block` is no longer the normal mechanism for ADR/DMD human Q&A
- `task_block` remains for genuine commissioner action, environment problems, malformed input, or situations where a role truly cannot continue
- Questions must be asked **one at a time**
- Roles may identify multiple open decisions during one examination pass, but must ask them sequentially, not as one batched prompt
- Dependent questions must wait for earlier answers before asking the next one
- Questions should still be asked verbatim from the decision artifact where applicable; the role must not reinterpret or "helpfully" fill gaps
- If `ask_sensei` is cancelled or unavailable in a real role flow, the role may either:
  - ask a single clarifying follow-up if the only missing piece is rationale capture, or
  - `task_block` with an honest reason when commissioner action is genuinely required

## Audit findings

Historical relay assumptions were found in these files and have now been rewritten:

- `skills/unfolding-orchestrator/SKILL.md`
- `skills/unfolding-orchestrator/pi.md`
- `skills/unfolding-orchestrator/claude.md`
- `extensions/unfolding/roles/architect.md`
- `extensions/unfolding/roles/po.md`
- `extensions/unfolding/README.md`
- `extensions/unfolding/index.ts`
- `extensions/unfolding/roles/ui-expert.md`

Semantic sweep result:

- remaining mentions of "extract question text" are negative instructions telling the orchestrator **not** to do that
- no remaining positive relay workflow was found in the rewritten orchestrator/role docs

## Validation status

Completed:

- `npm run sync-extensions`
- `npm --prefix extensions/unfolding test`
- automated proof that delegated **Architect** child sessions can ask Sensei directly in the pi runtime
- automated proof that delegated **PO** child sessions can ask Sensei directly in the pi runtime
- automated proof that a **restored/resumed** child session can still use proxied `ask_sensei` in the pi runtime
- prior real pi TUI probe proving delegated **Architect** direct questioning works interactively in the pi runtime

Still pending:

- real pi TUI probe for delegated **PO** direct questioning — skipped by user
- proof of equivalent direct-questioning capability in the Claude/OpenCode variants (not attempted here)

## Progress log

- [x] Added this tracked plan file
- [x] Defined the direct-questioning policy and fallback rules
- [x] Audited current relay assumptions and recorded affected files
- [x] Defined the new direct-questioning protocol and sequential batching rule
- [x] Updated Architect and PO role guidance for direct `ask_sensei` questioning
- [x] Tightened the Architect prompt so ADRs must be asked immediately, not self-resolved or left as "draft and stop"
- [x] Removed ADR awareness from the PO role guidance; PO now handles only PO-scope blocked questions
- [x] Removed normal ADR/DMD relay behavior from the pi orchestrator guidance and extension docs
- [x] Updated the process overview to describe Sensei interaction as runtime-dependent
- [x] Verified runtime/tool exposure behavior in automated tests
- [x] Added automated tests for direct questioning and resumed-session proxying
- [x] Ran sync + unfolding test validation successfully
- [x] Reviewed semantic leftovers in the rewritten docs
- [x] Prepared the final direct-questioning commit
- [x] Keep this file current as implementation progresses
