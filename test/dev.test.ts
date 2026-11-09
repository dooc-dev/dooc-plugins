import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createHash } from "node:crypto";
import config from "../dev/viewer.js";

const { createPluginRuntime } = await import(new URL("./plugins/runtime.js", import.meta.resolve("@dooc-dev/dooc")).href);
const documents = ["overview", "linear", "github", "slack"].map(name =>
  readFileSync(new URL(`../../dev/content/${name}.md`, import.meta.url), "utf8"));
const urls = [...new Set(documents.flatMap(text => [...text.matchAll(/!\[[^\]]*\]\((https:\/\/[^)]+)\)/g)].map(match => match[1])))];

for (const plugin of config.plugins) {
  test(`dev ${plugin.id}: real plugin renders all demo URLs through local OAuth and API mocks`, async () => {
    const mock = config.mocks[plugin.id];
    const runtime = createPluginRuntime([plugin], async (source: string, init: RequestInit) => {
      assert.equal(new URL(source).origin, mock.origin);
      return mock.handle(new Request(source, init));
    });
    const session = runtime.createSession();
    const callback = `http://localhost:5179/api/plugins/callback/${plugin.id}`;
    const authorize = runtime.connect(session, plugin.id, callback);
    const response = await mock.handle(new Request(authorize));
    assert.equal(response.status, 303);
    await runtime.callback(session, plugin.id, callback, new URL(response.headers.get("location")!).searchParams);
    const matched = urls.filter(source => plugin.matches(new URL(source)));
    assert(matched.length >= 3);
    for (const source of matched) {
      assert.equal(runtime.resolve(source), plugin.id);
      const { user, view } = await runtime.read(session, plugin.id, source);
      assert(Array.isArray((await runtime.actions(session, plugin.id, source)).actions));
      assert.equal(user.name, "Ada Mori");
      assert(!("format" in view)); assert(!("format" in view.collapsed));
      assert(!JSON.stringify(view).includes("Unavailable"), source);
      assert(!JSON.stringify(view).includes("demo-refresh-"));
    }
  });
}

test("all demo embeds are handled by exactly one plugin", () => {
  assert(urls.length >= 10);
  for (const url of urls) assert.equal(config.plugins.filter(plugin => plugin.matches(new URL(url))).length, 1, url);
});

test("demo OAuth rejects external callbacks, incorrect PKCE, replayed codes and unauthenticated reads", async () => {
  const plugin = config.plugins[0], mock = config.mocks[plugin.id];
  const verifier = "v".repeat(43), callback = `http://localhost:5179/api/plugins/callback/${plugin.id}`;
  const params = new URLSearchParams({ client_id: plugin.oauth.clientId, response_type: "code", redirect_uri: callback,
    scope: plugin.oauth.scopes.join(plugin.oauth.scopeSeparator ?? " "), state: "s".repeat(43), code_challenge_method: "S256",
    code_challenge: createHash("sha256").update(verifier).digest("base64url") });
  const external = new URLSearchParams(params); external.set("redirect_uri", "https://example.com/callback");
  assert.equal((await mock.handle(new Request(`${plugin.oauth.authorizationUrl}?${external}`))).status, 400);
  const authorize = async () => {
    const response = await mock.handle(new Request(`${plugin.oauth.authorizationUrl}?${params}`));
    assert.equal(response.status, 303);
    return new URL(response.headers.get("location")!).searchParams.get("code")!;
  };
  const exchange = (code: string, proof: string) => mock.handle(new Request(plugin.oauth.tokenUrl, { method: "POST", body: new URLSearchParams({
    client_id: plugin.oauth.clientId, grant_type: "authorization_code", redirect_uri: callback, code, code_verifier: proof,
  }) }));
  const badCode = await authorize();
  assert.equal((await exchange(badCode, "wrong".repeat(9))).status, 400);
  assert.equal((await exchange(badCode, verifier)).status, 400);
  const code = await authorize();
  const tokenResponse = await exchange(code, verifier);
  assert.equal(tokenResponse.status, 200);
  assert.equal((await exchange(code, verifier)).status, 400);
  assert.equal((await mock.handle(new Request(`${mock.origin}/graphql`))).status, 401);
  const token = await tokenResponse.json();
  const refresh = () => mock.handle(new Request(plugin.oauth.tokenUrl, { method: "POST", body: new URLSearchParams({
    client_id: plugin.oauth.clientId, grant_type: "refresh_token", refresh_token: token.refresh_token,
  }) }));
  assert.equal((await refresh()).status, 200); assert.equal((await refresh()).status, 400);
});

test("development mode isolates credentials and rejects unexpected API origins", async () => {
  for (const plugin of config.plugins) {
    assert.equal(plugin.oauth.clientSecret, undefined);
    assert.equal(plugin.oauth.clientId, `dooc-dev-${plugin.id}`);
    assert(plugin.apiOrigins.every(origin => origin.endsWith(".dooc.invalid")));
    assert.equal(config.mocks[plugin.id].autoConnect, true);
    const response = await config.mocks[plugin.id].handle(new Request("https://example.com/graphql"));
    assert.equal(response.status, 404);
  }
});
