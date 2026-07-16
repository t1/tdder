# pi-maven

Maven extension for [pi](https://github.com/earendil-works/pi-coding-agent), plus a standalone CLI (`tdder-maven`) for
agents that only have shell access (Claude Code, OpenCode, Cursor, …).

## Features

- **`maven_run`** — runs `test` or `package`, parses Surefire/Failsafe XML reports, returns structured JSON with failure
  details (kind, type, file offset)
- **`maven_project_info`** — detects project root, module tree, runner (`mvn`/`mvnw`), and available root-pom profiles
- **`maven_lookup_version`** — looks up the latest stable (or pre-release) version of any Maven dependency or plugin
  from Maven Central
- **`maven_available_java_versions`** — returns available Java releases from Adoptium (latest feature release, latest
  LTS, release age)
- **`/maven` command** — slash command with live progress widget for `info`, `test`, `package`, `version`, and
  `java-versions`
- **`tdder-maven` CLI** — same functionality as a standalone command for agents that only have shell access

## Installation (pi)

```bash
pi install git:github.com/t1/tdder
```

Or install just this package from npm:

```bash
pi install pi-maven
```

## CLI (`tdder-maven`)

Requires [`tsx`](https://github.com/privatenumber/tsx) on your `PATH`.

```
tdder-maven info
tdder-maven test --scope surefire
tdder-maven test --scope all --profiles at
tdder-maven test --scope surefire --selector 'MyTest#myMethod'
tdder-maven test --scope surefire --update-snapshots
tdder-maven test --scope surefire --limit=none
tdder-maven package
tdder-maven package --project module-a --profiles native
tdder-maven lookup-version org.assertj assertj-core
tdder-maven lookup-version io.quarkus quarkus-bom --include-prereleases
tdder-maven available-java-versions
tdder-maven help
```

All commands output structured JSON to stdout. Non-zero exit code on failure.

### Test scopes

| Scope      | Behaviour                                                          |
|------------|--------------------------------------------------------------------|
| `surefire` | Unit tests only (`mvn test`)                                       |
| `failsafe` | Integration tests only (`mvn verify -Dskip.surefire.tests=true …`) |
| `all`      | Unit + integration tests (`mvn verify -DskipITs=false`)            |

If `--scope failsafe` returns `SUREFIRE_SKIP_NOT_CONFIGURED`, follow the instructions in the error response.

## Release

1. `npm run sync-extensions` (from repo root) — vendor shared code
2. Bump `version` in `package.json`
3. `npm test` — verify all tests pass
4. `npm login`
5. `npm publish` (from this directory)
6. `npm logout`
