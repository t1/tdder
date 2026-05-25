# Debugger decisions

Read `extensions/idea/AGENTS.md` before this file.

## Debugger design decisions

**Security dialogue scope:** Only `xdebug_start_debugger_session` (and `execute_run_configuration`)
trigger the JetBrains security dialogue. `xdebug_set_breakpoint` does not — confirmed empirically
in < 5 ms in clean state. Earlier observations of `set_breakpoint` blocking were caused by a
stale dialogue from a timed-out `start_debugger_session` call surfacing at the wrong moment.

**Dialogue detection:** When `xdebug_start_debugger_session` blocks for > 3 s and
`xdebug_get_debugger_status` shows no sessions, the extension sets a `setWidget` warning
above the editor. The widget is cleared in `finally` so it disappears the moment the user
clicks Allow and the call returns. `ui.notify()` was rejected here because it is fire-and-forget
and cannot be withdrawn. The 3 s window distinguishes the dialogue case from fast warm starts.

**`xdebug_set_variable` and `xdebug_run_to_line` are registered:** initially considered
"dangerous", but `set_variable` fails gracefully on immutable fields and `run_to_line` is
equivalent to "Run to Cursor". Don't remove them on safety grounds — the tool guidance
strings carry the API-level details (path format, return semantics, response shapes).
