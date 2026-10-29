import { homedir } from "node:os";

export type MavenAction = "test" | "package";
export type TestScope = "surefire" | "failsafe" | "all";

export interface MavenCommandOptions {
  action: MavenAction;
  runner: string;
  selector?: string;
  project?: string;
  profiles?: string[];
  forceUpdate?: boolean;
  /** Arbitrary user properties, passed as -Dkey=value (appended last, so they override the curated flags). */
  properties?: Record<string, string>;
  /** Run Maven in offline mode (-o/--offline). Mutually exclusive with forceUpdate. */
  offline?: boolean;
  /** Required when action is "test". Controls which test runner(s) are invoked. */
  testScope?: TestScope;
}

/** Maps user properties to -Dkey=value arguments. Later flags win in Maven, so order matters. */
function propertyArgs(properties: Record<string, string> | undefined): string[] {
  return Object.entries(properties ?? {}).map(([key, value]) => {
    validatePropertyKey(key);
    return `-D${key}=${value}`;
  });
}

/** Validates a user property key: non-empty, no whitespace, no '=', no leading '-'. */
function validatePropertyKey(key: string): void {
  if (key.length === 0 || key.includes("=") || /\s/.test(key) || key.startsWith("-")) {
    throw new Error(`Invalid Maven property key '${key}': must be non-empty, without whitespace or '=', and no leading '-' (don't include the -D prefix)`);
  }
}

/**
 * Convert collected property tokens ("key=value" or bare "key") into a record.
 * Splits on the first '='; a token without '=' gets the empty string (like `-Dflag`).
 * Later duplicates win, mirroring Maven's last-`-D`-wins behavior.
 */
export function parsePropertyTokens(tokens: string | string[] | boolean | undefined): Record<string, string> {
  const list = Array.isArray(tokens) ? tokens : typeof tokens === "string" ? [tokens] : [];
  const properties: Record<string, string> = {};
  for (const token of list) {
    const eqIdx = token.indexOf("=");
    if (eqIdx === -1) properties[token] = "";
    else properties[token.slice(0, eqIdx)] = token.slice(eqIdx + 1);
  }
  return properties;
}

/**
 * Extract Maven-native `-Dkey=value` properties and offline flags (`-o`/`--offline`)
 * from free-form run arguments (as typed by a human in the /maven command),
 * leaving the remaining tokens for scope/selector parsing.
 */
export function parseMavenRunTokens(
  tokens: string[],
): { properties: Record<string, string>; offline: boolean; rest: string[] } {
  const propertyTokens: string[] = [];
  let offline = false;
  const rest: string[] = [];
  for (const token of tokens) {
    if (token.startsWith("-D") && token.length > 2) propertyTokens.push(token.slice(2));
    else if (token === "-o" || token === "--offline") offline = true;
    else rest.push(token);
  }
  return { properties: parsePropertyTokens(propertyTokens), offline, rest };
}

function quoteSelector(selector: string): string {
  return selector.includes("#") ? `'${selector}'` : selector;
}

interface PhaseOptions {
  goals: string[];
  flags: string[];
  selectorFlag: string;
}

/** Maps action + testScope to the Maven goals, flags, and selector flag prefix. */
function phaseOptions(action: MavenAction, testScope: TestScope | undefined): PhaseOptions {
  if (action === "package") {
    return { goals: ["package"], flags: ["-DskipTests"], selectorFlag: "" };
  }
  switch (testScope) {
    case "failsafe": return { goals: ["verify"], flags: ["-Dskip.surefire.tests=true", "-DskipITs=false"], selectorFlag: "-Dit.test=" };
    case "all":      return { goals: ["verify"], flags: ["-DskipITs=false"],                               selectorFlag: "-Dit.test=" };
    default:         return { goals: ["test"],   flags: [],                                                selectorFlag: "-Dtest=" };
  }
}

/**
 * Build the argv array for spawning Maven without a shell.
 * Selectors are passed as-is (no shell quoting needed).
 */
export function buildMavenArgs(opts: MavenCommandOptions): string[] {
  const { runner, selector, project, profiles, forceUpdate, properties, offline } = opts;
  if (forceUpdate && offline) {
    throw new Error("Cannot combine offline mode with forceUpdate (--offline and --update-snapshots are mutually exclusive)");
  }
  const { goals, flags, selectorFlag } = phaseOptions(opts.action, opts.testScope);
  const args = [runner];
  if (project) args.push("-pl", project, "-am");
  if (profiles && profiles.length > 0) args.push(`-P${profiles.join(",")}`);
  if (forceUpdate) args.push("--update-snapshots");
  if (offline) args.push("--offline");
  args.push(...goals, ...flags);
  if (selector && selectorFlag) args.push(`${selectorFlag}${selector}`);
  // User properties go last: Maven's last -D wins, so they deliberately override the flags above.
  args.push(...propertyArgs(properties));
  return args;
}

/**
 * Build a sandbox-safe environment for the Maven child process.
 *
 * Inside sandboxed runtimes (e.g. Claude Code), the Kotlin compiler daemon
 * writes discovery files (`.run`, `.tab`) to
 * `$(user.home)/Library/Application Support/kotlin/daemon` on macOS, which
 * the sandbox blocks for subprocesses. Redirecting `user.home` (and
 * `java.io.tmpdir` / `TMPDIR` for other temp writes) to
 * `<projectRoot>/target` keeps all daemon file I/O inside the project tree,
 * which Maven creates on its own.
 *
 * `user.home` in `MAVEN_OPTS` is propagated to the daemon JVM because Kotlin
 * copies parent JVM options when starting the daemon with `inheritMemoryLimits`.
 *
 * Maven derives its default local repository from `user.home`, so without a
 * countermeasure the redirect would silently relocate the repo to
 * `<projectRoot>/target/.m2` and re-download every dependency on each run.
 * `-Dmaven.repo.local` pins the repo back to the real home directory.
 *
 * @param projectRoot  Absolute path to the Maven project root.
 * @param baseEnv      Environment to inherit (defaults to process.env).
 */
export function buildMavenEnv(
  projectRoot: string,
  baseEnv: Record<string, string | undefined> = process.env,
): Record<string, string | undefined> {
  const tmpdir = `${projectRoot}/target`;
  const repoLocal = `${baseEnv.HOME ?? homedir()}/.m2/repository`;
  const existingOpts = baseEnv.MAVEN_OPTS ?? "";
  const tmpProps = `-Djava.io.tmpdir=${tmpdir} -Duser.home=${tmpdir} -Dmaven.repo.local=${repoLocal}`;
  const mavenOpts = existingOpts ? `${existingOpts} ${tmpProps}` : tmpProps;
  return { ...baseEnv, TMPDIR: tmpdir, MAVEN_OPTS: mavenOpts };
}

/** Display form of a -Dkey=value property; quotes values that would break shell copy-paste. */
function displayProperty(key: string, value: string): string {
  const arg = `-D${key}=${value}`;
  return /[\s#]/.test(arg) ? `'${arg}'` : arg;
}

/**
 * Build a human-readable command string for display and result payloads.
 * Selectors containing '#' are quoted for readability.
 */
export function buildMavenCommand(opts: MavenCommandOptions): string {
  const { runner, selector, project, profiles, forceUpdate, properties, offline } = opts;
  const { goals, flags, selectorFlag } = phaseOptions(opts.action, opts.testScope);
  const parts = [runner];
  if (project) parts.push(`-pl ${project}`, "-am");
  if (profiles && profiles.length > 0) parts.push(`-P${profiles.join(",")}`);
  if (forceUpdate) parts.push("--update-snapshots");
  if (offline) parts.push("--offline");
  parts.push(...goals, ...flags);
  if (selector && selectorFlag) parts.push(`${selectorFlag}${quoteSelector(selector)}`);
  for (const [key, value] of Object.entries(properties ?? {})) {
    parts.push(displayProperty(key, value));
  }
  return parts.join(" ");
}
