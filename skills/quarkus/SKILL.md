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

## Reference Topics

Load the referenced file when the situation matches.

| Situation                                                                                               | File                     |
|---------------------------------------------------------------------------------------------------------|--------------------------|
| Adding dev-only code (seeders, fake services, dev helpers): `src/dev/java` pattern or `@IfBuildProfile` | `dev-mode.md` |
