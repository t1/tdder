export type MavenAction = "test" | "package";
export type TestScope = "surefire" | "failsafe" | "all";

export interface MavenCommandOptions {
  action: MavenAction;
  runner: string;
  selector?: string;
  project?: string;
  /** Required when action is "test". Controls which test runner(s) are invoked. */
  testScope?: TestScope;
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
  const { runner, selector, project } = opts;
  const { goals, flags, selectorFlag } = phaseOptions(opts.action, opts.testScope);
  const args = [runner];
  if (project) args.push("-pl", project, "-am");
  args.push(...goals, ...flags);
  if (selector && selectorFlag) args.push(`${selectorFlag}${selector}`);
  return args;
}

/**
 * Build a sandbox-safe environment for the Maven child process.
 *
 * Inside sandboxed runtimes (e.g. Claude Code), the Kotlin compiler daemon
 * tries to create session files in the system temp dir which the sandbox
 * blocks.  Redirecting TMPDIR and java.io.tmpdir to <projectRoot>/target
 * avoids the issue — Maven creates that directory on its own.
 *
 * @param projectRoot  Absolute path to the Maven project root.
 * @param baseEnv      Environment to inherit (defaults to process.env).
 */
export function buildMavenEnv(
  projectRoot: string,
  baseEnv: Record<string, string | undefined> = process.env,
): Record<string, string | undefined> {
  const tmpdir = `${projectRoot}/target`;
  const existingOpts = baseEnv.MAVEN_OPTS ?? "";
  const tmpProp = `-Djava.io.tmpdir=${tmpdir}`;
  const mavenOpts = existingOpts ? `${existingOpts} ${tmpProp}` : tmpProp;
  return { ...baseEnv, TMPDIR: tmpdir, MAVEN_OPTS: mavenOpts };
}

/**
 * Build a human-readable command string for display and result payloads.
 * Selectors containing '#' are quoted for readability.
 */
export function buildMavenCommand(opts: MavenCommandOptions): string {
  const { runner, selector, project } = opts;
  const { goals, flags, selectorFlag } = phaseOptions(opts.action, opts.testScope);
  const parts = [runner];
  if (project) parts.push(`-pl ${project}`, "-am");
  parts.push(...goals, ...flags);
  if (selector && selectorFlag) parts.push(`${selectorFlag}${quoteSelector(selector)}`);
  return parts.join(" ");
}
