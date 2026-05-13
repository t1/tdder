export interface FailedTest {
  className: string;
  methodName: string;
  message: string;
  reportFile?: string;
}

export interface TestSummary {
  testsRun: number;
  failures: number;
  errors: number;
  skipped: number;
  failedTests: FailedTest[];
}

// ---------------------------------------------------------------------------
// Surefire / Failsafe XML report parsing
// ---------------------------------------------------------------------------

function attrInt(xml: string, attr: string): number {
  const match = xml.match(new RegExp(`${attr}="(\\d+)"`));
  return match ? parseInt(match[1], 10) : 0;
}

function attrStr(xml: string, attr: string): string {
  const match = xml.match(new RegExp(`${attr}="([^"]*)"`));
  return match ? match[1] : "";
}

export function parseSurefireReport(xml: string): TestSummary {
  const suiteMatch = xml.match(/<testsuite([^>]*)>/);
  const suiteAttrs = suiteMatch ? suiteMatch[0] : "";

  const testsRun = attrInt(suiteAttrs, "tests");
  const failures = attrInt(suiteAttrs, "failures");
  const errors = attrInt(suiteAttrs, "errors");
  const skipped = attrInt(suiteAttrs, "skipped");

  const failedTests: FailedTest[] = [];

  // Remove self-closing <testcase .../> tags so the loop below only sees blocks with children
  const stripped = xml.replace(/<testcase[^>]*\/>/g, "");
  const testcasePattern = /<testcase([^>]*)>([\s\S]*?)<\/testcase>/g;
  for (const tcMatch of stripped.matchAll(testcasePattern)) {
    const tcAttrs = tcMatch[1];
    const tcBody = tcMatch[2];
    const failureMatch = tcBody.match(/<failure\s+message="([^"]*)"[^>]*>/);
    if (!failureMatch) continue;

    failedTests.push({
      className: attrStr(tcAttrs, "classname"),
      methodName: attrStr(tcAttrs, "name"),
      message: failureMatch[1],
    });
  }

  return { testsRun, failures, errors, skipped, failedTests };
}

// ---------------------------------------------------------------------------
// Console output parsing
// ---------------------------------------------------------------------------

// Compilation errors look like: [ERROR] /path/to/File.java:[line,col] error: ...
const COMPILATION_ERROR_RE = /^\[ERROR\]\s+.+\.java:\[\d+,\d+\].+$/;

export function extractCompilationErrors(output: string): string[] {
  return output
    .split("\n")
    .filter((line) => COMPILATION_ERROR_RE.test(line))
    .map((line) => line.replace(/^\[ERROR\]\s+/, "").trim());
}

export function extractBuildErrors(output: string): string[] {
  return output
    .split("\n")
    .filter((line) => /^\[ERROR\]/.test(line) && !COMPILATION_ERROR_RE.test(line))
    .map((line) => line.replace(/^\[ERROR\]\s+/, "").trim())
    .filter(Boolean);
}
