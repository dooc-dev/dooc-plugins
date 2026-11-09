import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { inflateRawSync } from "node:zlib";
import type { DataPlugin } from "@dooc-dev/dooc-plugin";
import { users } from "./fixtures.js";
import { githubFixture, linearFixture, slackFixture } from "../dev/fixtures.js";
import { render } from "./render.js";

const host = (path: string) => import(new URL(path, import.meta.resolve("@dooc-dev/dooc")).href);
const { readExtensionZip } = await host("core/extension-package.js");
const { validateViewerPlugins } = await host("viewer/plugin-config.js");
const { version } = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
const sums = readFileSync(new URL("../releases/SHA256SUMS", import.meta.url), "utf8");
const keys = ["LINEAR", "GITHUB", "SLACK"].flatMap(service => [`DOOC_${service}_CLIENT_ID`, `DOOC_${service}_CLIENT_SECRET`]);
const saved = keys.map(key => process.env[key]);
const folder = mkdtempSync(join(tmpdir(), "dooc-plugin-consumer-"));
try {
  for (const key of keys) process.env[key] = "package-test-credential";
  for (const [service, name, fixture, url] of [
    ["linear", "Linear", linearFixture, "https://linear.app/acme/issue/DOC-42"],
    ["github", "GitHub", githubFixture, "https://github.com/acme/docs/pull/42"],
    ["slack", "Slack", slackFixture, "https://acme.slack.com/archives/C123/p1794128400000000"],
  ] as const) {
    const filename = `dooc-${service}-${version}.zip`;
    const bytes = readFileSync(new URL(`../releases/${filename}`, import.meta.url));
    assert(sums.includes(`${createHash("sha256").update(bytes).digest("hex")}  ${filename}\n`));
    const pkg = await readExtensionZip(bytes, async (data: Uint8Array, size: number) => inflateRawSync(data, { maxOutputLength: Math.max(1, size) }));
    assert.equal(pkg.name, `dooc-${service}`); assert.equal(pkg.version, version); assert(pkg.icon?.light);
    for (const file of pkg.files) {
      assert(!/node_modules|\.env|^dev\/|^test\//.test(file.name), file.name);
      const destination = join(folder, service, file.name);
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, file.data);
    }
    const entry = pathToFileURL(join(folder, service, pkg.main)).href;
    const config = validateViewerPlugins((await import(entry)).default);
    assert.deepEqual(config.plugins.map((plugin: DataPlugin) => plugin.id), [service]);
    const plugin: DataPlugin = config.plugins[0];
    assert.equal(plugin.name, name); assert(plugin.icon?.light);
    assert.equal(plugin.oauth.clientId, "package-test-credential");
    if (service === "slack") assert.equal(plugin.oauth.clientSecret, undefined);
    const context = { ...fixture(), user: users[service] };
    const result = await plugin.read(new URL(url), context);
    assert(!("format" in result)); assert(result.collapsed && !("format" in result.collapsed));
    assert.match(render(result), /plugin-block-heading/);
    assert(plugin.actions); assert((await plugin.actions(new URL(url), context)).length > 0);
    const key = `DOOC_${service.toUpperCase()}_CLIENT_ID`;
    delete process.env[key];
    await assert.rejects(import(`${entry}?missing-client`), new RegExp(`Set ${key}`));
    process.env[key] = "package-test-credential";
    if (service === "github") {
      delete process.env.DOOC_GITHUB_CLIENT_SECRET;
      await assert.rejects(import(`${entry}?missing-secret`), /Set both/);
      process.env.DOOC_GITHUB_CLIENT_SECRET = "package-test-credential";
    }
    console.log(`${filename}: isolated import, configuration, assets, rendering and actions passed`);
  }
} finally {
  for (let i = 0; i < keys.length; i++) {
    if (saved[i] === undefined) delete process.env[keys[i]];
    else process.env[keys[i]] = saved[i];
  }
  rmSync(folder, { recursive: true, force: true });
}
