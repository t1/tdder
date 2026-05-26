---
name: quarkus
description: >
  Always load this skill when working on a Quarkus project (quarkus-maven-plugin present in pom.xml).
  It provides Quarkus-specific patterns and gotchas that complement the java and maven skills.
version: 0.1.0
---

# Quarkus

Quarkus-specific conventions and patterns.
Language- and build-tool-specific conventions are covered by the `java` and `maven` skills.

## Reference Topics

Load the referenced file when the situation matches.

| Situation                                                                                               | File                     |
|---------------------------------------------------------------------------------------------------------|--------------------------|
| Adding dev-only code (seeders, fake services, dev helpers): `src/dev/java` pattern or `@IfBuildProfile` | `references/dev-mode.md` |
