---
name: quarkus
description: >
  Always load this skill when working on a Quarkus project, when the quarkus-maven-plugin is
  present in pom.xml, or when project setup has already chosen Quarkus before the pom.xml exists
  yet. It provides Quarkus-specific patterns and gotchas that complement the java and maven skills.
version: 0.1.0
---

# Quarkus

Quarkus-specific conventions and patterns.
Language- and build-tool-specific conventions are covered by the `java` and `maven` skills.

## Choosing Quarkus Capabilities

**Quarkus-specific setup is not generic build-file work.**
When adding a Quarkus capability, do **not** start by hand-writing `pom.xml` or `build.gradle` changes.
Use this decision ladder:

1. **Use Quarkus-aware tools first.** If dedicated Quarkus tooling is available in the environment, use it to discover the right capability, extension, or setup workflow.
2. **Check the `quarkus` CLI next.** Before editing build files by hand, check whether the `quarkus` CLI can create or apply the required setup.
3. **Only then edit Maven or Gradle files manually.** If you fall back to hand-written build changes, state explicitly why the higher-level Quarkus mechanisms were not suitable.

If you find yourself adding `io.quarkus:*` dependencies, BOM entries, or `quarkus-maven-plugin` configuration by hand, stop and check whether this should be done through Quarkus-aware tooling or the `quarkus` CLI instead.

## Reference Topics

Load the referenced file when the situation matches.

| Situation                                                                                               | File                     |
|---------------------------------------------------------------------------------------------------------|--------------------------|
| Adding dev-only code (seeders, fake services, dev helpers): `src/dev/java` pattern or `@IfBuildProfile` | `dev-mode.md` |
