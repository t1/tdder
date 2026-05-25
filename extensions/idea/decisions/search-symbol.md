# search_symbol matching behaviour

Read `extensions/idea/AGENTS.md` before this file.

Probed live against a TypeScript project (tdder) and a Kotlin/Quarkus project (cc).
All findings are empirical — JetBrains does not document the matching semantics.

## Matching model

### Bare name: case-insensitive substring on symbol name

`q="Office"` matches any symbol whose name contains "office" (case-insensitive),
regardless of position. It is **not** prefix-only: `q="Client"` and `q="cpCli"`
both match `McpClient`.

### Dotted name: package path filter + symbol name match

When the query contains dots, the **last segment** is matched against symbol names
(same substring rule), and the **preceding segments** filter by package path.

```
q="office.Office"                      → symbols named *Office* in any …office… package
q="de.codecentric.people.office.Office" → same result set; extra path precision is redundant
q="de.codecentric"                     → 0 hits — "codecentric" is not a symbol name
```

Consequence: **searching by bare package prefix returns nothing useful.** The last segment
must be a symbol name (or `*`), not a package component.

One qualifying segment is enough — `"office.Office"` and the full FQN return identical
results. Use the shortest suffix that disambiguates.

### `package.*`: package enumeration, but slow

`q="office.*"` returns all symbols in any package whose path contains "office".
It works, but the `*` as symbol name triggers a much broader search:

- Bare named queries return in milliseconds.
- `"office.*"` on a small project nearly hit the default 5 s RPC timeout.
- On a larger codebase it will time out unless `executionTimeoutMs` is raised.

Results are not perfectly scoped: `"de.codecentric.people.office.*"` included
`OfficeRefDTO` from the `employee` package because its name contains "office".
The package filter is applied to the path segments, but symbol names are still
matched by substring, so cross-package leakage happens when names share a word
with the package.

Broader wildcards (`"people.*"`) span all sub-packages because every sub-package
FQN contains "people".

### CamelCase abbreviations

IDEA applies its standard "Go to Class" CamelCase matching. `q="DDS"` finds
`DevDataSeeder` (Dev + Data + Seeder initials). Words can be skipped, mixed with
partial expansions, and queried case-insensitively:

| query   | matches        |
|---------|----------------|
| `DDS`   | DevDataSeeder  |
| `dds`   | DevDataSeeder  |
| `DS`    | DevDataSeeder (skipping middle word) |
| `DDSe`  | DevDataSeeder  |
| `DeDS`  | DevDataSeeder  |
| `DDSeeder` | DevDataSeeder |

CamelCase matching is useful for human-typed queries. LLMs already know full class
names, so they rarely benefit from it.

### Globs on named queries: redundant

`q="Mcp"` and `q="Mcp*"` return identical results because the bare query is already
unanchored substring matching. Globs only add value in the `"package.*"` pattern.

## Summary table

| Query form              | Behaviour                                  | Speed   |
|-------------------------|--------------------------------------------|---------|
| `ClassName`             | substring on name, no package filter       | fast    |
| `pkg.ClassName`         | substring on name, scoped to pkg path      | fast    |
| `full.fqn.ClassName`    | same as one-segment qualifier              | fast    |
| `pkg.*`                 | all symbols in pkg (slow, cross-pkg noise) | slow    |
| `pkg.name` (no class)   | 0 results — last segment is symbol name    | fast    |
| `CamelAbbrev`           | CamelCase initials/partial matching        | fast    |

## What is relevant for the LLM

Two things materially change what the LLM should do:

1. **Prefer a package-qualified name for common class names.**
   `"office.Office"` (11 hits, office-pkg only) vs `"Office"` (17 hits, including
   `Employee.office` fields from unrelated packages).

2. **`"package.*"` enumerates a package but may time out.**
   Use it only when you need a broad survey and are prepared for a slow response.
   Prefer named queries when you know (part of) the class name.

CamelCase, globs on named queries, and case-insensitivity are all correct to use
but do not need to be in guidance — the LLM's natural behaviour already aligns with them.
