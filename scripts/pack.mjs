import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isBuiltin } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const output = join(root, "dist/releases");
const cli = fileURLToPath(new URL("./cli.js", import.meta.resolve("@dooc-dev/dooc")));
const staging = mkdtempSync(join(tmpdir(), "dooc-plugin-pack-"));
const checksums = [];
mkdirSync(output, { recursive: true });
try {
  for (const [service, icon] of [["linear", "linear-light.svg"], ["github", "github-light.svg"], ["slack", "slack.svg"]]) {
    const folder = join(staging, service), main = "dist/src/viewer.js";
    const bundle = await build({
      entryPoints: [join(root, `src/extensions/${service}.ts`)],
      outfile: join(folder, main), bundle: true, platform: "node", format: "esm", target: "node22", metafile: true,
      // YAML uses CommonJS imports of Node built-ins inside the ESM bundle.
      banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' },
    });
    assert(Object.values(bundle.metafile.outputs).every(file => file.imports.every(item => isBuiltin(item.path))), "All dependencies must be bundled");
    cpSync(join(root, "assets"), join(folder, "assets"), { recursive: true });
    if (service === "github") cpSync(join(root, "node_modules/yaml/LICENSE"), join(folder, "YAML-LICENSE"));
    writeFileSync(join(folder, "package.json"), JSON.stringify({ name: `dooc-${service}`, version, type: "module", main, icon: `assets/brands/${icon}` }, null, 2) + "\n");
    const filename = `dooc-${service}-${version}.zip`;
    execFileSync(process.execPath, [cli, "plugin", "pack", folder, join(output, filename)], { stdio: "inherit" });
    const hash = createHash("sha256").update(readFileSync(join(output, filename))).digest("hex");
    checksums.push(`${hash}  ${filename}`);
  }
  writeFileSync(join(output, "SHA256SUMS"), checksums.join("\n") + "\n");
} finally {
  rmSync(staging, { recursive: true, force: true });
}
