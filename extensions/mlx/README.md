# pi-mlx

pi extension for MLX-backed local providers that auto-recovers when the local model stalls mid-task.

## Stall recovery

Quantized local models (e.g. Qwen via `mlx-lm`) sometimes lose tool-call format discipline: the model emits the tool call as raw XML — the `tool_call`, `parameter`, `invoke`, or `function_call` tags — **inside its thinking output** instead of as a real tool call. The harness then sees a thinking-only assistant turn with `stopReason: "stop"` and nothing happens — the session silently waits for the user to type `continue`.

The extension detects exactly this pattern on `message_end`:

- **xml-confidence stall** — thinking-only, `stop`, and tool-call markup fragments in the thinking content
- **bare stall** — thinking-only, `stop`, no markup (could be legitimate, but mid-task it almost never is)

On each stall it shows a notification (`warning`; `error` when giving up) and sends the model a nudge via `pi.sendUserMessage`:

> It looks like you tried to call a tool, but the call ended up as raw XML inside your thinking output and was never executed. If that's the case, do it properly now: emit the tool call as an actual tool call, not inside thinking. Otherwise, continue with your task.

Auto-recovery is capped at 2 consecutive stalls; the counter resets on any healthy assistant message. After the cap, an `error` notification asks the user to take over.

This recovery is provider-agnostic in principle and **could live in a separate extension** (nothing about it is MLX-specific — it's gated on `mlx-lm` only because that's where the failure mode has been observed). It lives here for now to keep the number of extensions small.

## Why the extension is still called `mlx`

The name predates the extension's current scope. It originally also injected repetition-focused request defaults via a hook; that half moved to pi's native `samplingParams`, leaving only stall recovery — which is provider-agnostic in principle and is gated on `mlx-lm` only because that's where the failure mode has been observed. The name is kept to avoid breaking existing `pi --extension` invocations.

## Development

```bash
npm --prefix extensions/mlx test
```

Load locally:

```bash
pi --extension /path/to/tdder/extensions/mlx
```
