import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
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
  const plugin = factory(options), context = makeContext();
  validateViewerPlugins({ plugins: [plugin] });
  let exchanges = 0;
  const runtime = createPluginRuntime([plugin], async (source: string, init: RequestInit) => {
    if (source === plugin.oauth.tokenUrl) {
      exchanges++;
      assert.equal((init.body as URLSearchParams).get("client_id"), options.clientId);
      assert.equal((init.body as URLSearchParams).get("client_secret"), plugin.id === "slack" ? null : options.clientSecret);
      if (exchanges === 1) assert((init.body as URLSearchParams).get("code_verifier"));
      else assert.equal((init.body as URLSearchParams).get("grant_type"), "refresh_token");
      const token = { access_token: "user-token", refresh_token: "user-refresh", token_type: plugin.id === "slack" ? "user" : "Bearer", expires_in: exchanges === 1 && plugin.id !== "github" ? 1 : 3600 };
      return Response.json(plugin.id === "slack" ? { ok: true, ...(exchanges === 1 ? { authed_user: token } : token) } : token);
    }
    assert.equal(new Headers(init.headers).get("authorization"), "Bearer user-token");
    assert(!source.includes("user-token"));
    return Response.json(await context.request(source, { method: init.method as "GET" | "POST", ...(init.body ? { body: JSON.parse(String(init.body)) } : {}) }));
  });
  assert.equal(runtime.resolve(url), plugin.id);
  const session = runtime.createSession(), callback = `http://localhost:5179/api/plugins/callback/${plugin.id}`;
  const auth = new URL(runtime.connect(session, plugin.id, callback));
  assert.equal(auth.searchParams.get("code_challenge_method"), "S256");
  if (plugin.id === "slack") { assert(auth.searchParams.has("user_scope")); assert(!auth.searchParams.has("scope")); }
  await runtime.callback(session, plugin.id, callback, new URLSearchParams({ state: auth.searchParams.get("state")!, code: "fixture-code" }));
  const result = await runtime.read(session, plugin.id, url);
  assert.deepEqual(result.user, context.user);
  assert.equal(exchanges, plugin.id === "github" ? 1 : 2);
  const html = pluginViewHtml(result.view);
  assert.match(html, /plugin-blocks/); assert(!html.includes("<iframe"));
  assert(!html.includes("test-secret")); assert(!html.includes("user-token"));
  previews.push(`<h2>${plugin.id}</h2>${html}<h3>Collapsed</h3>${pluginViewHtml(result.view.collapsed)}`);
  console.log(`${plugin.id}: host registration, OAuth, identity, read, native blocks and token isolation passed`);
}
if (process.env.PREVIEW_PATH) {
  writeFileSync(process.env.PREVIEW_PATH, `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>dooc plugin previews</title><style>body{font:14px system-ui;max-width:900px;margin:24px auto;padding:0 12px}h2{margin-top:32px}</style><h1>dooc plugin previews — fixture data</h1>${previews.join("")}</html>`);
}
