import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { exportFromFile } from "/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/export-html/index.js";
import { readTask } from "./task-store.ts";

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
