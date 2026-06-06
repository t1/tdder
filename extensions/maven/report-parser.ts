import { readFileSync } from "node:fs";

export interface TestTiming {
  className: string;
  methodName: string;
  durationSeconds: number;
}

export interface FailedTest {
  kind: "failure" | "error";
  type?: string;
  className: string;
  methodName?: string;
  displayName?: string;
  message: string;
  rerunSelector: string;
  rerunScope: "method" | "class";
  reportFile: string;
  reportFileOffset: number;
  reportFileLimit: number;
}

export interface TestSummary {
  testsRun: number;
  failures: number;
  errors: number;
  skipped: number;
  durationSeconds: number;
  totalOnDisk?: number;
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

function lineOf(xml: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) {
    if (xml[i] === "\n") line++;
  }
  return line;
}

function lineCount(text: string): number {
  let count = 1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") count++;
  }
  return count;
}

export function parseSurefireReport(
  filePath: string,
  options?: { includeTimings?: boolean },
): { summary: TestSummary; failedTests: FailedTest[]; testTimings?: TestTiming[] } {
  const xml = readFileSync(filePath, "utf8");

  const suiteMatch = xml.match(/<testsuite([^>]*)>/);
  const suiteAttrs = suiteMatch ? suiteMatch[0] : "";
  const suiteClass = attrStr(suiteAttrs, "name");

  const testsRunFromAttrs = attrInt(suiteAttrs, "tests");
  const failuresFromAttrs = attrInt(suiteAttrs, "failures");
  const errorsFromAttrs = attrInt(suiteAttrs, "errors");
  const skipped = attrInt(suiteAttrs, "skipped");
  const durationSeconds = parseFloat(attrStr(suiteAttrs, "time") || "0") || 0;

  const failedTests: FailedTest[] = [];
  let testsRunFromTestcases = 0;
  let failuresFromTestcases = 0;
  let errorsFromTestcases = 0;

  // Match all <testcase> blocks; self-closing ones have no body so the failure/error check skips them.
  const testcasePattern = /<testcase((?:[^>]|(?!\/>)>)*?)(\/>|(>[\s\S]*?<\/testcase>))/g;
  for (const tcMatch of xml.matchAll(testcasePattern)) {
    const tcAttrs = tcMatch[1];
    const tcBody = tcMatch[3] ?? "";
    testsRunFromTestcases++;
    const failureMatch = tcBody.match(/<(failure|error)\s+message="([^"]*)"[^>]*>/);
    if (!failureMatch) continue;

    const kind = failureMatch[1] as "failure" | "error";
    if (kind === "failure") failuresFromTestcases++; else errorsFromTestcases++;
    const type = kind === "error" ? attrStr(failureMatch[0], "type") || undefined : undefined;
    const rawClassName = attrStr(tcAttrs, "classname");
    const rawName = attrStr(tcAttrs, "name");
    const message = decodeXmlEntities(failureMatch[2]);

    // suiteClass is the JUnit runner / top-level class. If classname is that class or a
    // $-nested subclass, this is a JUnit test and the selector is classname#method
    // (with ()[N] / (T)[N] suffixes stripped — they aren't valid in -Dtest=).
    // If classname is unrelated (Cucumber: it's a feature title), only the runner
    // class itself can be targeted, which reruns all its scenarios.
    const isJavaClass = suiteClass === rawClassName || suiteClass.startsWith(rawClassName + "$") || rawClassName.startsWith(suiteClass + "$");

    const className = isJavaClass ? rawClassName : suiteClass;
    const methodName = isJavaClass ? rawName : undefined;
    const displayName = isJavaClass ? undefined : rawName;
    const rerunScope: "method" | "class" = isJavaClass ? "method" : "class";
    const rerunSelector = isJavaClass
      ? `${className}#${methodName!.replace(/[([].*/u, "")}`
      : suiteClass;

    const matchText = tcMatch[0];
    const reportFileOffset = lineOf(xml, tcMatch.index ?? 0);
    const reportFileLimit = lineCount(matchText);

    failedTests.push({ kind, ...(type !== undefined ? { type } : {}), className, methodName, displayName, message, rerunSelector, rerunScope, reportFile: filePath, reportFileOffset, reportFileLimit });
  }

  let testTimings: TestTiming[] | undefined;
  if (options?.includeTimings) {
    testTimings = [];
    const allPattern = /<testcase([^>]*)\/?>|<testcase([^>]*)>/g;
    for (const m of xml.matchAll(allPattern)) {
      const attrs = m[1] ?? m[2];
      const methodName = attrStr(attrs, "name");
      const className = attrStr(attrs, "classname");
      const durationSeconds = parseFloat(attrStr(attrs, "time") || "0") || 0;
      if (methodName && className) testTimings.push({ className, methodName, durationSeconds });
    }
  }

  // Use testcase-derived counts when the suite header under-reports (e.g. Kotlin @Nested classes)
  const testsRun = Math.max(testsRunFromAttrs, testsRunFromTestcases);
  const failures = Math.max(failuresFromAttrs, failuresFromTestcases);
  const errors = Math.max(errorsFromAttrs, errorsFromTestcases);
  return { summary: { testsRun, failures, errors, skipped, durationSeconds }, failedTests, testTimings };
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

// Test-failure noise: lines Surefire/Failsafe prints when tests fail — already covered
// by failedTests and testSummary, so they add no signal in buildErrors.
const TEST_FAILURE_NOISE_RE = /^(Tests run:.*<<<|.*-- Time elapsed:.*<<<|Failures:\s*$|Errors:\s*$|Tests run:.*Failures:|Failed to execute goal.*There are test failures|(See|Please refer to) .*(surefire|failsafe)-reports|See dump files|-> \[Help|To see the full stack trace|Re-run Maven|For more information about the errors|\[Help \d+\])/;

export function extractBuildErrors(output: string): string[] {
  const result: string[] = [];
  let inFailureBody = false;
  for (const raw of output.split("\n")) {
    if (!/^\[ERROR\]/.test(raw) || COMPILATION_ERROR_RE.test(raw)) continue;
    const content = raw.replace(/^\[ERROR\]/, "");
    // `[ERROR] Failures: ` / `[ERROR] Errors: ` open a failure-body block;
    // any non-indented line closes it.
    if (/^ (Failures|Errors):\s*$/.test(content)) { inFailureBody = true; continue; }
    if (/^ /.test(content)) { if (inFailureBody) continue; }
    else { inFailureBody = false; }
    const line = content.trim();
    if (line.length > 0 && !TEST_FAILURE_NOISE_RE.test(line)) result.push(line);
  }
  return result;
}
