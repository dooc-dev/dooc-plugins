import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { setTimeout } from "node:timers/promises";
import { createGitHubPlugin, createLinearPlugin, createSlackPlugin } from "../src/index.js";
import { githubContext, linearContext, slackContext, options } from "./fixtures.js";

const host = (path: string) => import(new URL(path, import.meta.resolve("@dooc-dev/dooc")).href);
const { createPluginRuntime } = await host("plugins/runtime.js");
const { validateViewerPlugins } = await host("viewer/plugin-config.js");
const { pluginViewHtml } = await host("viewer/plugin-view.js");
const previews = [];
for (const [factory, makeContext, url] of [
  [createLinearPlugin, linearContext, "https://linear.app/acme/issue/DOC-42"],
  [createGitHubPlugin, githubContext, "https://github.com/acme/docs/pull/42"],
  [createSlackPlugin, slackContext, "https://acme.slack.com/archives/C123/p1700000000123456"],
] as const) {
  const plugin = factory({ clientId: options.clientId }), context = makeContext();
  validateViewerPlugins({ plugins: [plugin] });
  assert.equal(plugin.oauth.clientSecret, undefined);
  let exchanges = 0, polls = 0;
  const runtime = createPluginRuntime([plugin], async (source: string, init: RequestInit) => {
    if (source === plugin.oauth.deviceAuthorizationUrl) {
      assert.equal(init.method, "POST");
      const body = init.body as URLSearchParams;
      assert.equal(body.get("client_id"), options.clientId);
      assert.equal(body.get("scope"), plugin.oauth.scopes.join(" "));
      assert(!body.has("client_secret"));
      return Response.json({ device_code: "private-device-code", user_code: "DOOC-TEST", verification_uri: "https://github.com/login/device", expires_in: 900, interval: 1 });
    }
    if (source === plugin.oauth.tokenUrl) {
      const body = init.body as URLSearchParams;
      assert.equal(body.get("client_id"), options.clientId);
      assert(!body.has("client_secret"));
      if (plugin.id === "github") {
        assert.equal(body.get("grant_type"), "urn:ietf:params:oauth:grant-type:device_code");
        assert.equal(body.get("device_code"), "private-device-code");
        if (++polls === 1) return Response.json({ error: "authorization_pending" }, { status: 400 });
      } else if (exchanges === 0) assert(body.get("code_verifier"));
      else assert.equal(body.get("grant_type"), "refresh_token");
      exchanges++;
      const token = { access_token: "user-token", refresh_token: "user-refresh", token_type: plugin.id === "slack" ? "user" : "Bearer", expires_in: exchanges === 1 && plugin.id !== "github" ? 1 : 3600 };
      return Response.json(plugin.id === "slack" ? { ok: true, ...(exchanges === 1 ? { authed_user: token } : token) } : token);
    }
    assert.equal(new Headers(init.headers).get("authorization"), "Bearer user-token");
    assert(!source.includes("user-token"));
    return Response.json(await context.request(source, { method: init.method as "GET" | "POST", ...(init.body ? { body: JSON.parse(String(init.body)) } : {}) }));
  });
  assert.equal(runtime.resolve(url), plugin.id);
  const session = runtime.createSession(), callback = `http://localhost:5179/api/plugins/callback/${plugin.id}`;
  if (plugin.id === "github") {
    assert.equal(plugin.oauth.deviceAuthorizationUrl, "https://github.com/login/device/code");
    assert.throws(() => runtime.connect(session, plugin.id, callback), /device authorization/);
    const state = await runtime.connectDevice(session, plugin.id);
    await assert.rejects(runtime.pollDevice(runtime.createSession(), plugin.id, state), /Invalid or expired/);
    const pending = await runtime.pollDevice(session, plugin.id, state);
    assert.equal(pending.userCode, "DOOC-TEST");
    assert.equal(pending.verificationUri, "https://github.com/login/device");
    assert(!JSON.stringify(pending).includes("private-device-code"));
    assert.equal(polls, 0);
    await setTimeout(1100);
    assert.equal((await runtime.pollDevice(session, plugin.id, state)).userCode, "DOOC-TEST");
    assert.equal(runtime.status(session, plugin.id), undefined);
    await setTimeout(1100);
    assert.equal(await runtime.pollDevice(session, plugin.id, state), undefined);
    assert.equal(polls, 2);
  } else {
    assert.equal(plugin.oauth.deviceAuthorizationUrl, undefined);
    const auth = new URL(runtime.connect(session, plugin.id, callback));
    assert.equal(auth.searchParams.get("code_challenge_method"), "S256");
    if (plugin.id === "slack") { assert(auth.searchParams.has("user_scope")); assert(!auth.searchParams.has("scope")); }
    await runtime.callback(session, plugin.id, callback, new URLSearchParams({ state: auth.searchParams.get("state")!, code: "fixture-code" }));
  }
  const result = await runtime.read(session, plugin.id, url);
  assert.deepEqual(result.user, context.user);
  assert.equal(exchanges, plugin.id === "github" ? 1 : 2);
  const html = pluginViewHtml(result.view);
  assert.match(html, /plugin-blocks/); assert(!html.includes("<iframe"));
  assert(!html.includes("test-secret")); assert(!html.includes("user-token"));
  previews.push(`<h2>${plugin.id}</h2>${html}<h3>Collapsed</h3>${pluginViewHtml(result.view.collapsed)}`);
  console.log(`${plugin.id}: host registration, ${plugin.id === "github" ? "Device Flow" : "PKCE and refresh"} without secrets, identity, read and token isolation passed`);
}
if (process.env.PREVIEW_PATH) {
  writeFileSync(process.env.PREVIEW_PATH, `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>dooc plugin previews</title><style>body{font:14px system-ui;max-width:900px;margin:24px auto;padding:0 12px}h2{margin-top:32px}</style><h1>dooc plugin previews — fixture data</h1>${previews.join("")}</html>`);
}
