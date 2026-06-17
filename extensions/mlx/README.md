# pi-mlx

pi extension for MLX-backed local providers that injects a small, repetition-focused request preset before provider calls are sent.

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
