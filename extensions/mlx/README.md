# pi-mlx

pi extension for MLX-backed local providers that injects a small, repetition-focused request preset before provider calls are sent, and auto-recovers when the local model stalls mid-task.

## Stall recovery

Quantized local models (e.g. Qwen via `mlx-lm`) sometimes lose tool-call format discipline: the model emits the tool call as raw XML (`<tool_call>…<parameter=…>…</parameter>…</tool_call>`) **inside its thinking output** instead of as a real tool call. The harness then sees a thinking-only assistant turn with `stopReason: "stop"` and nothing happens — the session silently waits for the user to type `continue`.

The extension detects exactly this pattern on `message_end`:

- **xml-confidence stall** — thinking-only, `stop`, and tool-call markup fragments in the thinking content
- **bare stall** — thinking-only, `stop`, no markup (could be legitimate, but mid-task it almost never is)

On each stall it shows a notification (`warning`; `error` when giving up) and sends the model a nudge via `pi.sendUserMessage`:

> It looks like you tried to call a tool, but the call ended up as raw XML inside your thinking output and was never executed. If that's the case, do it properly now: emit the tool call as an actual tool call, not inside thinking. Otherwise, continue with your task.

Auto-recovery is capped at **2 consecutive stalls**; the counter resets on any healthy assistant message. After the cap, an `error` notification asks the user to take over.

This recovery is provider-agnostic in principle and **could live in a separate extension** (nothing about it is MLX-specific — it's gated on `mlx-lm` only because that's where the failure mode has been observed). It lives here for now to keep the number of extensions small.

## Why this uses a hook

pi does not expose MLX request defaults as first-class model configuration.
For this use case, the practical integration point is `before_provider_request`, where the extension can fill missing request fields right before the payload is sent.

One limitation of the current pi API is that this hook exposes only the serialized payload, not an explicit provider field on the event itself. V1 therefore targets requests indirectly via `ctx.model.provider`. That is correct for pi's current runtime, but it is still a coupling to current API shape rather than a stronger event-level contract.

## V1 scope

Version 1 is intentionally narrow:

- targets exactly one provider name: `mlx-lm`
- uses `before_provider_request`
- injects only absent fields
- focuses only on repetition-related controls
- leaves non-target providers untouched
- has no user configuration

## Injected defaults

For provider `mlx-lm`, the extension fills these fields only when they are absent from the outgoing payload:

- `repetition_penalty: 1.1`
- `repetition_context_size: 128`

If the caller already set either field, the caller's value wins.

## Safe no-op behavior

The payload is left unchanged when:

- the active model context is missing
- `ctx.model.provider` is missing or not a string
- the provider is not exactly `mlx-lm`
- the outgoing payload is not a non-null object

The extension does not infer targeting from `baseUrl`, model id, or payload shape.

## Why V1 stays narrow

The problem being validated is repetition. So V1 changes only the smallest plausible pair of repetition-focused knobs instead of also tuning temperature or sampling.

## Not in V1

V1 does **not** add or tune:

- `presence_penalty`
- `frequency_penalty`
- `temperature`
- `top_p`
- `top_k`

Those are deferred so the first validation cut isolates the effect of the repetition-focused defaults.

## Development

```bash
npm --prefix extensions/mlx test
```

Load locally:

```bash
pi --extension /path/to/tdder/extensions/mlx
```
