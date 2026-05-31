import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

export const rootDir = resolve(import.meta.dirname, "..");
export const extensionsDir = join(rootDir, "extensions");
export const rootPackagePath = join(rootDir, "package.json");
export const lockfilePath = join(rootDir, "package-lock.json");

export type PackageJson = Record<string, unknown>;

export type ExtensionPackage = {
  dirName: string;
  packagePath: string;
  packageJson: PackageJson;
};

export function findExtensionPackages(): ExtensionPackage[] {
  if (!existsSync(extensionsDir)) {
    throw new Error(`Missing extensions directory: ${extensionsDir}`);
  }

  return readdirSync(extensionsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      dirName: entry.name,
      packagePath: join(extensionsDir, entry.name, "package.json"),
    }))
    .filter(({ packagePath }) => existsSync(packagePath))
    .map(({ dirName, packagePath }) => ({
      dirName,
      packagePath,
      packageJson: readJson<PackageJson>(packagePath),
    }))
    .sort((a, b) => a.dirName.localeCompare(b.dirName));
}

export function readJson<T>(path: string): T {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch (error) {
    throw new Error(`Failed to parse JSON from ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}
