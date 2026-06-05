/**
 * Canonical guidance strings shared between the pi tool descriptions (index.ts)
 * and the CLI help text (cli.ts).
 *
 * Keep this file free of runtime logic — plain string constants only.
 */

/**
 * Explains the layout of the `maven_project_info` / `tdder-maven info` result:
 * top-level coordinates belong to the root POM, not the current module.
 */
export const INFO_LAYOUT =
  "The top-level coordinates (groupId, artifactId, packaging, …) always describe the root POM. " +
  "Use currentPath to locate the current module inside the modules tree when you need its own coordinates.";

/**
 * Full error message emitted when --scope failsafe is requested but the POM does not
 * wire skip.surefire.tests to Surefire's <skip>. Includes the POM fix so the LLM can
 * act on it immediately without needing the skill.
 */
export const SUREFIRE_SKIP_NOT_CONFIGURED_MESSAGE =
  "The project POM does not define a 'skip.surefire.tests' property wired to Surefire's <skip> configuration. " +
  "Tell the user and ask them about adding the following to the POM before retrying:\n\n" +
  "In <properties>:\n" +
  "  <skip.surefire.tests>false</skip.surefire.tests>\n\n" +
  "In the maven-surefire-plugin <configuration>:\n" +
  "  <skip>${skip.surefire.tests}</skip>\n\n" +
  "Do NOT fall back to --scope all on your own — ask the user what they want to do.";
