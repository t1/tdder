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

/**
 * Build the argv array for spawning Maven without a shell.
 * Selectors are passed as-is (no shell quoting needed).
 */
export function buildMavenArgs(opts: MavenCommandOptions): string[] {
  const { action, runner, selector, project, testScope } = opts;

  const args: string[] = [runner];
  if (project) args.push("-pl", project);

  switch (action) {
    case "test":
      switch (testScope) {
        case "surefire":
          args.push("test");
          if (selector) args.push(`-Dtest=${selector}`);
          break;
        case "failsafe":
          args.push("verify", "-Dskip.surefire.tests=true", "-DskipITs=false");
          if (selector) args.push(`-Dit.test=${selector}`);
          break;
        case "all":
          args.push("verify", "-DskipITs=false");
          if (selector) args.push(`-Dit.test=${selector}`);
          break;
      }
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
  const { action, runner, selector, project, testScope } = opts;

  const parts: string[] = [runner];
  if (project) parts.push(`-pl ${project}`);

  switch (action) {
    case "test":
      switch (testScope) {
        case "surefire":
          parts.push("test");
          if (selector) parts.push(`-Dtest=${quoteSelector(selector)}`);
          break;
        case "failsafe":
          parts.push("verify", "-Dskip.surefire.tests=true", "-DskipITs=false");
          if (selector) parts.push(`-Dit.test=${quoteSelector(selector)}`);
          break;
        case "all":
          parts.push("verify", "-DskipITs=false");
          if (selector) parts.push(`-Dit.test=${quoteSelector(selector)}`);
          break;
      }
      break;
    case "package":
      parts.push("package", "-DskipTests");
      break;
  }

  return parts.join(" ");
}
