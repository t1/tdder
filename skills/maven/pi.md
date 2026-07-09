# Maven — pi Bindings

## Tool Order

Prefer agent-oriented tools in this order:

1. `maven_run`
2. `maven_project_info`
3. `maven_lookup_version`
4. `maven_available_java_versions`

If `maven_run` is available, prefer it over raw `mvn` — it enforces correct flags,
parses Surefire/Failsafe XML reports, and returns a compact structured result, so it
actually hurts to inspect raw output manually.

If `maven_run` is not available, run `tdder-maven help` to learn the syntax and examples,
then use it. If that also fails (command not found or your use-case is not supported),
fall back to raw `mvn`.

**TRYING TO USE AGENT-ORIENTED TOOLS IS MANDATORY**. Don't use `mvn` without having tried,
or because you consider the job too small.

## Project Info

Use `maven_project_info` to get the project structure, module tree, runner, and available root pom profiles.

If not available, use the CLI via bash: `tdder-maven info`.

If that's also not available, look into the `<modules>` elements of the root pom and recurse
into the directories' poms.

## Version Lookup

Use `maven_lookup_version` if available.

Otherwise use the CLI:

```bash
tdder-maven lookup-version org.assertj assertj-core
tdder-maven lookup-version io.quarkus quarkus-bom --include-prereleases
```

## Downloading New Dependencies

In `pi`, there is no supported "run Maven without the sandbox" escape hatch.
Do **not** suggest `dangerouslyDisableSandbox`, because that is not available here.
Do **not** tell the user to run `mvn dependency:resolve` outside the sandbox as a standard workaround.

Instead:

- run the real goal with `maven_run` and let Maven resolve dependencies as part of that goal
- if Maven should refresh remote snapshots and metadata, use `forceUpdate=true`
- if resolution still fails because the environment blocks network or filesystem access, report that constraint honestly instead of inventing an unsandboxed workaround

`maven_run` examples when remote refresh may matter:

- `maven_run(action='test', testScope='surefire', forceUpdate=true)`
- `maven_run(action='package', forceUpdate=true)`

If you suggest a follow-up Maven action to the user, tell them to use the `/maven` command,
not raw `mvn`.

## Running Tests

Use `maven_run` with `action="test"`.
If the documented project command requires Maven profiles, pass them via `profiles=[...]`.
If not available, use `tdder-maven test --scope --profiles`.
Only if neither is available, use raw `mvn`.

## Building

Use `maven_run` with `action="package"`.
If the documented project command requires Maven profiles, pass them via `profiles=[...]`.
If not available, use `tdder-maven package --profiles`.
Only if neither is available, use raw `mvn`.
