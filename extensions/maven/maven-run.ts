export type MavenAction = "test" | "integration-test" | "verify" | "package";

export interface MavenCommandOptions {
  action: MavenAction;
  runner: string;
  selector?: string;
  project?: string;
}

function quoteSelector(selector: string): string {
  return selector.includes("#") ? `'${selector}'` : selector;
}

export function buildMavenCommand(opts: MavenCommandOptions): string {
  const { action, runner, selector, project } = opts;

  const parts: string[] = [runner];
  if (project) parts.push(`-pl ${project}`);

  switch (action) {
    case "test":
      parts.push("test");
      if (selector) parts.push(`-Dtest=${quoteSelector(selector)}`);
      break;
    case "integration-test":
      parts.push("verify", "-Dskip.surefire.tests", "-DskipITs=false");
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
