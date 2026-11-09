import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { inflateRawSync } from "node:zlib";
import type { DataPlugin } from "@dooc-dev/dooc-plugin";
import { users } from "./fixtures.js";
import { githubFixture, linearFixture, slackFixture } from "../dev/fixtures.js";
import { render } from "./render.js";

const host = (path: string) => import(new URL(path, import.meta.resolve("@dooc-dev/dooc")).href);
const { readExtensionZip } = await host("core/extension-package.js");
const { validateViewerPlugins } = await host("viewer/plugin-config.js");
const { version } = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
const pack = fileURLToPath(new URL("../../scripts/pack.mjs", import.meta.url));
const keys = ["LINEAR", "GITHUB", "SLACK"].flatMap(service => [`DOOC_${service}_CLIENT_ID`, `DOOC_${service}_CLIENT_SECRET`]);
const saved = keys.map(key => process.env[key]);
const folder = mkdtempSync(join(tmpdir(), "dooc-plugin-consumer-"));
try {
  const clients = join(folder, "oauth-clients.json"), output = join(folder, "releases");
  writeFileSync(clients, "{}");
  const missing = spawnSync(process.execPath, [pack, "--clients", clients, "--output", output], { encoding: "utf8" });
  assert.notEqual(missing.status, 0); assert.match(missing.stderr, /Register the LINEAR OAuth application/);
  writeFileSync(clients, JSON.stringify({ LINEAR: "package-linear-app", GITHUB: "package-github-app", SLACK: "package-slack-app", CLIENT_SECRET: "must-not-be-bundled" }));
  const secret = spawnSync(process.execPath, [pack, "--clients", clients, "--output", output], { encoding: "utf8" });
  assert.notEqual(secret.status, 0); assert.match(secret.stderr, /never secrets/);
  writeFileSync(clients, JSON.stringify({ LINEAR: "package-linear-app", GITHUB: "package-github-app", SLACK: "package-slack-app" }));
  execFileSync(process.execPath, [pack, "--clients", clients, "--output", output], { stdio: "inherit" });
  const sums = readFileSync(join(output, "SHA256SUMS"), "utf8");
  for (const key of keys) delete process.env[key];
  for (const [service, name, fixture, url] of [
    ["linear", "Linear", linearFixture, "https://linear.app/acme/issue/DOC-42"],
    ["github", "GitHub", githubFixture, "https://github.com/acme/docs/pull/42"],
    ["slack", "Slack", slackFixture, "https://acme.slack.com/archives/C123/p1794128400000000"],
  ] as const) {
    const filename = `dooc-${service}-${version}.zip`;
    const bytes = readFileSync(join(output, filename));
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
    assert.equal(plugin.oauth.clientId, `package-${service}-app`);
    assert.equal(plugin.oauth.clientSecret, undefined);
    if (service === "github") {
      assert("deviceAuthorizationUrl" in plugin.oauth);
      assert.equal(plugin.oauth.deviceAuthorizationUrl, "https://github.com/login/device/code");
    }
    const context = { ...fixture(), user: users[service] };
    const result = await plugin.read(new URL(url), context);
    assert(!("format" in result)); assert(result.collapsed && !("format" in result.collapsed));
    assert.match(render(result), /plugin-block-heading/);
    assert(plugin.actions); assert((await plugin.actions(new URL(url), context)).length > 0);
    const key = `DOOC_${service.toUpperCase()}_CLIENT_ID`;
    process.env[key] = "user-setting-must-not-override-publisher";
    const again = (await import(`${entry}?user-env`)).default.plugins[0];
    assert.equal(again.oauth.clientId, `package-${service}-app`);
    assert.equal(again.oauth.clientSecret, undefined);
    delete process.env[key];
    console.log(`${filename}: isolated import, configuration, assets, rendering and actions passed`);
  }
} finally {
  for (let i = 0; i < keys.length; i++) {
    if (saved[i] === undefined) delete process.env[keys[i]];
    else process.env[keys[i]] = saved[i];
  }
  rmSync(folder, { recursive: true, force: true });
}
