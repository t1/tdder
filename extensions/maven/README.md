# pi-maven

Maven extension for [pi](https://github.com/earendil-works/pi-coding-agent) — structured test execution, project info,
and version lookup.

See the [main README](../../README.md#maven) for full documentation.

## Release

1. `npm run sync-extensions` (from repo root) — vendor shared code
2. Bump `version` in `package.json`
3. `npm test` — verify all tests pass
4. `npm login`
5. `npm publish` (from this directory)
6. `npm logout`
