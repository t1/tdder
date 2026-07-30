import {describe, it} from "node:test";
import assert from "node:assert/strict";
import {execFileSync, spawnSync} from "node:child_process";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";

const extensionDir = resolve(import.meta.dirname, "..");

describe("vendored yaml", () => {
  it("sync script resolves yaml via require.resolve instead of a hardcoded node_modules path", () => {
    const pkg = JSON.parse(readFileSync(resolve(extensionDir, "package.json"), "utf8"));
    assert.match(pkg.scripts.sync, /require\.resolve/);
    assert.doesNotMatch(pkg.scripts.sync, /\.\.\/\.\.\/node_modules\/yaml/);
  });

  it("vendor/yaml/dist/index.js and vendor/yaml/package.json exist after sync", () => {
    execFileSync("npm", ["run", "sync", "--silent"], {cwd: extensionDir, stdio: "pipe"});
    readFileSync(resolve(extensionDir, "vendor/yaml/dist/index.js"));
    readFileSync(resolve(extensionDir, "vendor/yaml/package.json"));
  });

  it("vendored yaml is loadable and exports parse", async () => {
    const yaml = await import(resolve(extensionDir, "vendor/yaml/dist/index.js"));
    assert.equal(typeof yaml.parse, "function");
    assert.deepEqual(yaml.parse("a: 1"), {a: 1});
  });

  it("sync fails loudly instead of producing an empty vendor when yaml is not installed", () => {
    const rootDir = resolve(extensionDir, "../..");
    const yamlDir = resolve(rootDir, "node_modules/yaml");
    const stashDir = resolve(rootDir, "node_modules/.yaml-stashed");
    execFileSync("rm", ["-rf", resolve(extensionDir, "vendor/yaml")]);
    execFileSync("mv", [yamlDir, stashDir]);
    try {
      const result = spawnSync("npm", ["run", "sync", "--silent"], {cwd: extensionDir, stdio: "pipe"});
      assert.notEqual(result.status, 0, "sync must fail when yaml is not resolvable");
      assert.throws(() => readFileSync(resolve(extensionDir, "vendor/yaml/dist/index.js")));
    } finally {
      execFileSync("mv", [stashDir, yamlDir]);
      execFileSync("npm", ["run", "sync", "--silent"], {cwd: extensionDir, stdio: "pipe"});
    }
  });
});
