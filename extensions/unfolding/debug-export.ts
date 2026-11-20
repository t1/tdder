import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { getPackageDir } from "@earendil-works/pi-coding-agent";
import { readTask } from "./task-store.ts";

// exportFromFile is not re-exported from the package root, and the package
// location is not stable: managed installs (pi 1.6.0) keep releases under
// ~/.pi/agent/install/releases/<version>/node_modules/..., not the Homebrew
// prefix. Resolve the internal module relative to the running package instead.
type ExportFromFile = (inputPath: string, outputPath: string) => Promise<string>;

let exportFromFilePromise: Promise<ExportFromFile> | undefined;

function loadExportFromFile(): Promise<ExportFromFile> {
  exportFromFilePromise ??= import(
    pathToFileURL(join(getPackageDir(), "dist", "core", "export-html", "index.js")).href
  ).then((module) => module.exportFromFile as ExportFromFile);
  return exportFromFilePromise;
}

export const UNFOLDING_EXPORTS_DIR = ".pi/unfolding/exports";

function pad2(value: number): string {
  return value.toString().padStart(2, "0");
}

function localIsoTimestampToSecond(date: Date = new Date()): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

export async function exportSessionHtml(cwd: string, name: string, sessionFile?: string): Promise<void> {
  if (!sessionFile || !existsSync(sessionFile)) return;
  const dir = join(cwd, UNFOLDING_EXPORTS_DIR);
  await mkdir(dir, { recursive: true });
  const timestamp = localIsoTimestampToSecond();
  const exportFromFile = await loadExportFromFile();
  await exportFromFile(sessionFile, join(dir, `${timestamp}-${name}.html`));
}

export async function exportTaskSessionHtml(cwd: string, slug: string, sessionFile?: string): Promise<void> {
  await exportSessionHtml(cwd, slug, sessionFile);
}

export async function exportTaskCommissionerSessionHtml(cwd: string, slug: string, sessionFile?: string): Promise<void> {
  await exportSessionHtml(cwd, `${slug}.commissioner`, sessionFile);
}

export async function exportTaskDebugHtmlIfEnabled(cwd: string, slug: string, enabled: boolean): Promise<void> {
  if (!enabled) return;
  const task = readTask(cwd, slug);
  await exportTaskSessionHtml(cwd, slug, task?.session_file);
}

export async function exportTaskCommissionerDebugHtmlIfEnabled(cwd: string, slug: string, enabled: boolean, sessionFile?: string): Promise<void> {
  if (!enabled) return;
  await exportTaskCommissionerSessionHtml(cwd, slug, sessionFile);
}
