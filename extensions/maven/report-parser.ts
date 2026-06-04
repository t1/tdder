export interface FailedTest {
  className: string;
  methodName?: string;
  displayName?: string;
  message: string;
  rerunSelector: string;
  rerunScope: "method" | "class";
  reportFile?: string;
}

export interface TestSummary {
  testsRun: number;
  failures: number;
  errors: number;
  skipped: number;
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
  return match ? decodeXmlEntities(match[1]) : "";
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

export function parseSurefireReport(xml: string): { summary: TestSummary; failedTests: FailedTest[] } {
  const suiteMatch = xml.match(/<testsuite([^>]*)>/);
  const suiteAttrs = suiteMatch ? suiteMatch[0] : "";
  const suiteClass = attrStr(suiteAttrs, "name");

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

    const rawClassName = attrStr(tcAttrs, "classname");
    const rawName = attrStr(tcAttrs, "name");
    const message = decodeXmlEntities(failureMatch[1]);

    // suiteClass is the JUnit runner / top-level class. If classname is that class or a
    // $-nested subclass, this is a JUnit test and the selector is classname#method
    // (with ()[N] / (T)[N] suffixes stripped — they aren't valid in -Dtest=).
    // If classname is unrelated (Cucumber: it's a feature title), only the runner
    // class itself can be targeted, which reruns all its scenarios.
    const isJavaClass = suiteClass === rawClassName || suiteClass.startsWith(rawClassName + "$");

    const className = isJavaClass ? rawClassName : suiteClass;
    const methodName = isJavaClass ? rawName : undefined;
    const displayName = isJavaClass ? undefined : rawName;
    const rerunScope: "method" | "class" = isJavaClass ? "method" : "class";
    const rerunSelector = isJavaClass
      ? `${className}#${methodName!.replace(/[([].*/u, "")}`
      : suiteClass;

    failedTests.push({ className, methodName, displayName, message, rerunSelector, rerunScope });
  }

  return { summary: { testsRun, failures, errors, skipped }, failedTests };
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
