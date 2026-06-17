# MLX extension plan

## Goal

Add a small pi extension named `mlx` that reduces looping in local `mlx_lm.server` usage by injecting **repetition-focused** request defaults for one selected OpenAI-compatible provider.

V1 does **not** detect whether a request is specifically a coding task. It applies to all requests sent through the selected provider.

This is intentionally a **v1 validation cut**, not a general sampling-policy extension.

## Why this extension is called `mlx`

The extension name is broader than v1 on purpose. It is meant to be the home for pi-side behavior that is specifically useful for providers backed by `mlx_lm.server`.

Version 1 still stays narrow: it validates one concrete improvement, repetition-focused request shaping for local MLX-backed sessions.

## Extension boundary

The `mlx` extension is for **MLX-specific** pi behavior.

Belongs here:

- request shaping specific to `mlx_lm.server`
- MLX-specific configuration
- MLX-specific diagnostics or payload inspection
- model-specific presets for MLX-hosted models

Does **not** belong here:

- generic OpenAI-compatible provider tuning that is not MLX-specific
- presets intended equally for Ollama, LM Studio, vLLM, or other local servers
- unrelated local-model UX features with no MLX-specific behavior
- general-purpose sampling policy extensions

Rule of thumb: if a feature would make equal sense in an extension named `openai-compatible-local-provider-defaults`, it probably does **not** belong in `mlx` unless it depends on MLX-specific behavior or configuration.

## Problem

`mlx_lm.server` accepts request-level sampling fields such as:

- `repetition_penalty`
- `repetition_context_size`
- `presence_penalty`
- `frequency_penalty`
- `temperature`
- `top_p`
- `top_k`

Pi does not expose these as first-class defaults in model configuration. For MLX-backed local providers, the practical integration point is the `before_provider_request` hook.

## v1 scope

V1 should:

- target exactly one hardcoded local OpenAI-compatible provider that fronts `mlx_lm.server`
- support only the provider name `mlx-lm`
- inject defaults only for fields that are absent
- focus on **repetition-related controls only**
- do nothing for non-target providers
- fail safe: if model context is missing or incomplete, leave the payload unchanged

## Out of scope for v1

- project or global configuration files
- model-id allowlists
- override mode for existing payload values
- dynamic per-model heuristics
- auto-detection of looping from previous completions
- presets for Ollama, LM Studio, vLLM, or other local servers
- UI, slash commands, footer widgets, or custom tools
- broad sampling tuning as a primary goal

## Why v1 stays narrow

The problem statement is repetition. If v1 changes many knobs at once (`temperature`, `top_p`, `top_k`, `repetition_penalty`, ...), it becomes impossible to tell which change helped or hurt.

V1 is meant to answer only one question:

- does a small repetition-focused payload change improve a known loop-prone local MLX setup?

So v1 should validate the smallest intervention that plausibly addresses the problem.

## Proposed behavior

Use `pi.on("before_provider_request", ...)` to inspect and optionally rewrite the outgoing payload.

### Hardcoded v1 provider target

V1 uses one implementation constant for the provider name: `mlx-lm`.

That provider name is **not** user-configurable in v1.

### Built-in v1 preset

V1 has one built-in preset:

- `repetition_penalty: 1.1`
- `repetition_context_size: 128`

Do **not** inject these additional fields in v1 unless later testing proves they are required:

- `presence_penalty`
- `frequency_penalty`
- `temperature`
- `top_p`
- `top_k`

Those are valid future experiments, but they would make v1 harder to evaluate.

## Matching strategy

### Primary target

Match the hardcoded provider name `mlx-lm` against `ctx.model.provider`.

### Safe fallback

If `ctx.model` is missing, or if `ctx.model.provider` is absent or not a string, bail out and return the payload unchanged.

If the outgoing payload is not a non-null object, bail out and return it unchanged.

Do not infer targeting from payload structure, `baseUrl`, model id, or any other heuristic unless the pi API forces it.

## Merge strategy

V1 merge rule:

- if the payload already contains `repetition_penalty`, keep the caller's value
- if the payload already contains `repetition_context_size`, keep the caller's value
- otherwise inject the built-in defaults

V1 does **not** support replacing existing payload values.

That keeps explicit caller choices authoritative and avoids surprising behavior.

## No configurability in v1

V1 deliberately has no extension-specific config files.

That means:

- no global config file
- no project config file
- no precedence rules
- no project-trust-dependent config behavior

This is intentional. The project-local configuration question is unresolved in pi: we have not established a clean, trust-compatible place for extension-owned configuration. Rather than invent a weak or misleading convention in v1, this version stays hardcoded and small.

Configurability is deferred to v2.

## Implementation outline

1. Create a new pi extension package in `extensions/mlx/`.
2. Define one hardcoded provider-name constant set to `mlx-lm`.
3. Define one built-in repetition preset.
4. Register a `before_provider_request` hook.
5. Read provider from `ctx.model`.
6. Bail out immediately if `ctx.model` is missing, if `ctx.model.provider` is absent or not a string, or if the provider does not match `mlx-lm`.
7. Bail out immediately if the payload is not a non-null object.
8. Merge the built-in repetition defaults into the outgoing payload only when those fields are absent.
9. Keep payload merge logic in a pure helper.
10. Add a README that explicitly documents the exact provider name `mlx-lm`, the injected v1 defaults, the no-config v1 constraint, the fact that only absent fields are filled, and the fact that non-target providers are unaffected.
11. If shared vendored code is used, run `npm run sync-extensions` per repo convention.

## Behavior contract

The extension must, for requests that actually pass through pi's `before_provider_request` hook:

- return the original payload unchanged for non-target providers
- return the original payload unchanged when `ctx.model` is missing
- return the original payload unchanged when `ctx.model.provider` is absent or not a string
- return the original payload unchanged when the payload is not a non-null object
- preserve existing payload values for `repetition_penalty` and `repetition_context_size`
- inject only `repetition_penalty` and `repetition_context_size` in v1
- never infer targeting from payload structure, `baseUrl`, or model id when model context is missing or incomplete
- expose no user configuration surface in v1

This contract is intentionally scoped to hook-covered requests. It does **not** claim that every internal pi request path is hook-covered.

## Testing plan

### Unit tests for pure merge logic

Cover at least:

- unrelated providers are unchanged
- matching provider gets defaults injected
- existing `repetition_penalty` is preserved
- existing `repetition_context_size` is preserved
- both existing fields are preserved when present
- missing or incomplete model context causes a safe no-op
- non-object payloads cause a safe no-op

### Hook wiring test

Add at least one lightweight integration-style test that verifies:

- the extension registers a `before_provider_request` handler
- the registered handler rewrites payloads for the target provider `mlx-lm`
- the registered handler leaves payloads unchanged for non-targets

A minimal fake `ExtensionAPI` is sufficient for v1. A full pi runtime end-to-end test is not required unless hook behavior turns out to depend on runtime details.

This is needed in addition to pure helper tests so event-contract mistakes are caught.

## Manual verification

Use one reproducible local scenario, not just general impressions.

Record at least:

- hardcoded provider name (`mlx-lm`)
- model id
- exact `mlx_lm.server` setup
- exact prompt used for comparison
- baseline behavior without the extension
- behavior with the extension enabled

Suggested success signal for v1:

- the known loop-prone prompt shows less visible repetition
- without obvious degradation on the same task

This manual check is validation evidence, not a substitute for the implementation acceptance criteria below.

## Acceptance criteria

### Implementation acceptance

- A dedicated `mlx` extension exists in this repo.
- It registers a `before_provider_request` hook.
- It targets exactly one hardcoded provider name: `mlx-lm`.
- It injects only the v1 repetition defaults.
- Existing payload values for those fields are preserved.
- Missing or incomplete model context causes a safe no-op.
- Non-object payloads cause a safe no-op.
- It has focused unit tests plus at least one hook-wiring test.
- Its README explicitly states that v1 supports only provider `mlx-lm`.
- Its README explicitly states that v1 injects only `repetition_penalty: 1.1` and `repetition_context_size: 128`.
- Its README explicitly states that existing caller-supplied values win.
- Its README explicitly states that v1 has no user configuration.
- Its README explicitly states that non-target providers are unaffected.

### Manual validation evidence

- A known loop-prone prompt behaves better than baseline when run against a real `mlx_lm.server` setup.

## Risks

- Some OpenAI-compatible local servers may ignore or reject one or more fields.
- A repetition penalty that helps one Qwen-family model may hurt another.
- Hardcoding the target provider makes v1 less reusable across machines.
- The current pi hook contract does not expose provider identity on `before_provider_request` itself; v1 must target indirectly via `ctx.model.provider`. That is correct for the current runtime, but it is a weaker contract than an event-level provider field and could become brittle if pi's routing model changes.
- If v1 expands into general sampling tuning too early, validation becomes inconclusive.

## Recommended first cut

Keep v1 intentionally small:

- one hardcoded provider-name match
- one hardcoded repetition preset
- preserve explicit caller values
- inject only `repetition_penalty` and `repetition_context_size`
- no configuration
- no UI
- no slash commands

If this proves useful, v2 can consider:

- configurable provider selection
- model-specific presets or allowlists
- optional override mode
- optional temperature/top-p/top-k tuning
- diagnostics or logging for payload verification
- support for additional local servers
- a proper extension-config approach once the config-location question is answered

## Open question deferred to v2

If v2 adds configurability, we must decide where extension-owned config belongs.

That question is intentionally deferred. V1 should not invent a config convention before we know whether pi supports a clean, trust-compatible location for it.

## Remaining work

### Repo hygiene

- [ ] Do one manual end-to-end test against local `mlx_lm.server`.

### Done when

- [ ] Manual validation shows a known loop-prone prompt behaves better than baseline against a real `mlx_lm.server` setup.
