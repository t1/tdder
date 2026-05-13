export type MavenAction = "test" | "integration-test" | "verify" | "package";

export interface MavenCommandOptions {
  action: MavenAction;
  runner: string;
  selector?: string;
  project?: string;
  /** Pass -Dskip.surefire.tests=true when running integration-test action.
   *  Only effective if the project defines this property in its POM. */
  skipUnitTests?: boolean;
}

function quoteSelector(selector: string): string {
  return selector.includes("#") ? `'${selector}'` : selector;
}

/**
 * Build the argv array for spawning Maven without a shell.
 * Selectors are passed as-is (no shell quoting needed).
 */
export function buildMavenArgs(opts: MavenCommandOptions): string[] {
  const { action, runner, selector, project, skipUnitTests } = opts;

  const args: string[] = [runner];
  if (project) args.push("-pl", project);

  switch (action) {
    case "test":
      args.push("test");
      if (selector) args.push(`-Dtest=${selector}`);
      break;
    case "integration-test":
      args.push("verify");
      if (skipUnitTests) args.push("-Dskip.surefire.tests=true");
      args.push("-DskipITs=false");
      if (selector) args.push(`-Dit.test=${selector}`);
      break;
    case "verify":
      args.push("verify");
      break;
    case "package":
      args.push("package", "-DskipTests");
      break;
  }

  return args;
}

/**
 * Build a human-readable command string for display and result payloads.
 * Selectors containing '#' are quoted for readability.
 */
export function buildMavenCommand(opts: MavenCommandOptions): string {
  const { action, runner, selector, project, skipUnitTests } = opts;

  const parts: string[] = [runner];
  if (project) parts.push(`-pl ${project}`);

  switch (action) {
    case "test":
      parts.push("test");
      if (selector) parts.push(`-Dtest=${quoteSelector(selector)}`);
      break;
    case "integration-test":
      parts.push("verify");
      if (skipUnitTests) parts.push("-Dskip.surefire.tests=true");
      parts.push("-DskipITs=false");
      if (selector) parts.push(`-Dit.test=${quoteSelector(selector)}`);
      break;
    case "verify":
      parts.push("verify");
      break;
    case "package":
      parts.push("package", "-DskipTests");
      break;
  }

  return parts.join(" ");
}
