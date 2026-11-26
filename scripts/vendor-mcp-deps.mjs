#!/usr/bin/env node
/**
 * Vendors the @earendil-works/pi-mcp runtime closure into an extension's vendor dir.
 *
 * pi's extension loader only aliases @earendil-works/pi-coding-agent, pi-agent-core,
 * pi-tui and pi-ai for extension imports — pi-mcp is bundled inside pi but NOT aliased,
 * so extensions must vendor it themselves. pi-mcp's dist has a single external runtime
 * dependency (cross-spawn), which we vendor along with its own transitive deps.
 *
 * Layout: <target>/node_modules/<pkg> so that pi-mcp's internal `import "cross-spawn"`
 * resolves via the standard node_modules ancestor walk, and the extension imports
 * pi-mcp relatively: ./vendor/node_modules/@earendil-works/pi-mcp/dist/index.js
 *
 * Usage: node scripts/vendor-mcp-deps.mjs <vendorDir>   (run from an extension dir)
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const target = resolve(process.argv[2] ?? "vendor");
const here = join(process.cwd(), "package.json");

/** Find a package's root dir from its ESM entry (exports maps often hide ./package.json). */
function packageRoot(pkg) {
  let dir = dirname(fileURLToPath(import.meta.resolve(pkg, here)));
  while (dir !== dirname(dir)) {
    const pj = join(dir, "package.json");
    if (existsSync(pj) && JSON.parse(readFileSync(pj, "utf8")).name === pkg) return dir;
    dir = dirname(dir);
  }
  throw new Error(`cannot locate package root for ${pkg}`);
}

// pi-mcp dist only; package.json for metadata. Then the cross-spawn closure.
const packages = [
  "@earendil-works/pi-mcp",
  "cross-spawn",
  "path-key",
  "shebang-command",
  "shebang-regex",
  "which",
  "isexe",
];

for (const pkg of packages) {
  const pkgDir = packageRoot(pkg);
  const pkgJsonPath = join(pkgDir, "package.json");
  const dest = join(target, "node_modules", pkg);
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dirname(dest), { recursive: true });
  if (pkg === "@earendil-works/pi-mcp") {
    // Only dist + package.json — skip src/maps if present.
    mkdirSync(dest, { recursive: true });
    cpSync(join(pkgDir, "dist"), join(dest, "dist"), { recursive: true });
    cpSync(pkgJsonPath, join(dest, "package.json"));
  } else {
    cpSync(pkgDir, dest, { recursive: true });
  }
  if (!existsSync(join(dest, "package.json"))) throw new Error(`vendored ${pkg} is missing package.json`);
}
console.log(`vendored ${packages.length} packages into ${target}/node_modules`);
