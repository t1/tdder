#!/usr/bin/env tsx

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

type DependencyMap = Record<string, string>;
const dependencyFields = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] as const;
type DependencyField = (typeof dependencyFields)[number];

type PackageJson = {
  license?: string;
  dependencies?: DependencyMap;
  devDependencies?: DependencyMap;
  peerDependencies?: DependencyMap;
  optionalDependencies?: DependencyMap;
  tdder?: {
    generatedRootDependencies?: boolean;
    generatedRootDependenciesNote?: string;
  };
  [key: string]: unknown;
};

type Lockfile = {
  packages?: {
    ""?: {
      dependencies?: DependencyMap;
      devDependencies?: DependencyMap;
      peerDependencies?: DependencyMap;
      optionalDependencies?: DependencyMap;
    };
  };
};

type ExtensionPackage = {
  dirName: string;
  packagePath: string;
  packageJson: PackageJson;
};

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = dirname(scriptDir);
const rootPackagePath = join(rootDir, "package.json");
const lockfilePath = join(rootDir, "package-lock.json");
const extensionsDir = join(rootDir, "extensions");

const GENERATED_NOTE =
  "Root dependency sections (dependencies, devDependencies, peerDependencies, optionalDependencies) are generated from extensions/*/package.json by npm run sync-root-deps. Do not edit those sections in the root package.json manually.";

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

function main(): void {
  const rootPackage = readJson<PackageJson>(rootPackagePath);
  assertGeneratedMetadata(rootPackage);

  const extensionPackages = findExtensionPackages();
  assertLicenseConsistency(rootPackage, extensionPackages);

  const generatedByField = Object.fromEntries(
    dependencyFields.map((field) => [field, collectExtensionDependencies(extensionPackages, field)]),
  ) as Record<DependencyField, DependencyMap>;

  const packageJsonChanged = dependencyFields.some((field) => {
    const current = normalizeDependencies(rootPackage[field], `root package.json ${field}`);
    const generated = generatedByField[field];
    return !sameDependencies(current, generated);
  });

  if (packageJsonChanged) {
    for (const field of dependencyFields) {
      const generated = generatedByField[field];
      if (Object.keys(generated).length === 0) {
        delete rootPackage[field];
      } else {
        rootPackage[field] = generated;
      }
    }
    writeJson(rootPackagePath, rootPackage);
    console.error("Updated generated dependency sections in root package.json. Run npm install to refresh package-lock.json.");
  }

  if (!existsSync(lockfilePath)) {
    fail("Missing package-lock.json. Run npm install.");
  }

  const lockfile = readJson<Lockfile>(lockfilePath);
  for (const field of dependencyFields) {
    const lockfileDependencies = normalizeDependencies(lockfile.packages?.[""]?.[field], `package-lock.json ${field}`);
    const generated = generatedByField[field];
    if (!sameDependencies(lockfileDependencies, generated)) {
      fail(`package-lock.json is out of sync for ${field}. Run npm install.`);
    }
  }

  if (packageJsonChanged) {
    fail("Root package.json was updated; package-lock.json must be refreshed before continuing.");
  }

  console.log(`Root dependency sections are in sync across ${extensionPackages.length} extension package(s).`);
}

function findExtensionPackages(): ExtensionPackage[] {
  if (!existsSync(extensionsDir)) {
    fail(`Missing extensions directory: ${extensionsDir}`);
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

function collectExtensionDependencies(
  extensionPackages: ExtensionPackage[],
  fieldName: DependencyField,
): DependencyMap {
  const ownersByDependency = new Map<string, string[]>();
  const versionByDependency = new Map<string, string>();

  for (const extensionPackage of extensionPackages) {
    const dependencies = readDependencyBlock(
      extensionPackage.packageJson,
      extensionPackage.packagePath,
      fieldName,
    );
    for (const [name, version] of Object.entries(dependencies)) {
      const owners = ownersByDependency.get(name) ?? [];
      const existingVersion = versionByDependency.get(name);
      if (existingVersion && existingVersion !== version) {
        const allOwners = [...owners, extensionPackage.dirName].sort().join(", ");
        fail(
          `${fieldName}: version mismatch for '${name}': '${existingVersion}' vs '${version}' across extensions ${allOwners}`,
        );
      }
      owners.push(extensionPackage.dirName);
      ownersByDependency.set(name, owners);
      versionByDependency.set(name, version);
    }
  }

  return Object.fromEntries([...versionByDependency.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

function assertGeneratedMetadata(rootPackage: PackageJson): void {
  if (rootPackage.tdder?.generatedRootDependencies !== true) {
    fail("package.json must declare tdder.generatedRootDependencies=true");
  }
  if (rootPackage.tdder?.generatedRootDependenciesNote !== GENERATED_NOTE) {
    fail(
      "package.json tdder.generatedRootDependenciesNote does not match the expected generated-dependencies note",
    );
  }
}

function assertLicenseConsistency(rootPackage: PackageJson, extensionPackages: ExtensionPackage[]): void {
  const rootLicense = normalizeLicense(rootPackage.license, rootPackagePath);
  for (const extensionPackage of extensionPackages) {
    const extensionLicense = normalizeLicense(extensionPackage.packageJson.license, extensionPackage.packagePath);
    if (extensionLicense !== rootLicense) {
      fail(
        `${extensionPackage.packagePath}: license '${extensionLicense}' does not match root package license '${rootLicense}'`,
      );
    }
  }
}

function normalizeLicense(license: unknown, sourcePath: string): string {
  if (typeof license !== "string" || license.trim() === "") {
    fail(`${sourcePath}: license must be a non-empty string`);
  }
  return license;
}

function readDependencyBlock(
  packageJson: PackageJson,
  packagePath: string,
  fieldName: DependencyField,
): DependencyMap {
  const block: PackageJson[DependencyField] = packageJson[fieldName];
  if (block === undefined) return {};
  if (!isDependencyMap(block)) {
    fail(`${packagePath}: '${fieldName}' must be an object with non-empty string values when present`);
  }

  return Object.fromEntries(Object.entries(block).sort(([a], [b]) => a.localeCompare(b)));
}

function normalizeDependencies(block: unknown, source: string): DependencyMap {
  if (block === undefined) return {};
  if (!isDependencyMap(block)) {
    fail(`${source} must be an object with non-empty string values when present`);
  }
  return Object.fromEntries(Object.entries(block).sort(([a], [b]) => a.localeCompare(b)));
}

function sameDependencies(left: DependencyMap, right: DependencyMap): boolean {
  const leftEntries = Object.entries(left);
  const rightEntries = Object.entries(right);
  if (leftEntries.length !== rightEntries.length) return false;
  return leftEntries.every(([name, version], index) => {
    const [otherName, otherVersion] = rightEntries[index] ?? [];
    return name === otherName && version === otherVersion;
  });
}

function isDependencyMap(value: unknown): value is DependencyMap {
  if (!isPlainObject(value)) return false;
  return Object.entries(value).every(
    ([name, version]) => name.trim() !== "" && typeof version === "string" && version.trim() !== "",
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJson<T>(path: string): T {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch (error) {
    fail(`Failed to parse JSON from ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function fail(message: string): never {
  throw new Error(message);
}
