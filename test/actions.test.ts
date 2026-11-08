import { render } from "./render.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { PassThrough } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import { PluginError } from "@sasaki-s-sci/dooc-plugin";
import { createLinearPlugin, createGitHubPlugin, createSlackPlugin } from "../src/index.js";
import type { ActionContext, ActionRequest, ActionResult, UrlAction } from "../src/actions.js";
import type { CardView } from "../src/cards.js";
interface Operation { kind: "actions" | "act"; input?: ActionRequest; requestId?: string }
import { createMockPlugin } from "../dev/mock.js";
import { linearFixture, githubFixture, slackFixture } from "../dev/fixtures.js";
import { users, options } from "./fixtures.js";
import { object, array } from "../src/common.js";

const hostRoot = new URL("./", import.meta.resolve("@sasaki-s-sci/dooc"));
type BaseRuntime = ReturnType<typeof import("../node_modules/@sasaki-s-sci/dooc/dist/plugins/runtime.js").createPluginRuntime>;
type Runtime = BaseRuntime;
const { createPluginRuntime } = await import(new URL("plugins/runtime.js", hostRoot).href) as {
  createPluginRuntime: (plugins: Parameters<typeof createMockPlugin>[0][], transport: (url: string, init: RequestInit) => Promise<Response>) => Runtime;
};
const operate = (runtime: Runtime, session: string, plugin: string, source: string, operation: Operation) => operation.kind === "actions" ? runtime.actions(session, plugin, source) : runtime.act(session, plugin, source, operation.input, operation.requestId);
const cases = [
  { service: "linear", factory: createLinearPlugin, fixture: linearFixture, url: "https://linear.app/acme/issue/DOC-42", create: "comment.create", update: "comment.update/", remove: "comment.delete/" },
  { service: "github", factory: createGitHubPlugin, fixture: githubFixture, url: "https://github.com/acme/docs/pull/42", create: "comment.create", update: "comment.update/", remove: "comment.delete/" },
  { service: "slack", factory: createSlackPlugin, fixture: slackFixture, url: "https://acme.slack.com/archives/C123/p1794128400000000", create: "reply.create", update: "message.update/", remove: "message.delete/" },
] as const;
const input = (action: UrlAction, overrides: Record<string, string> = {}, confirmed = false): ActionRequest => ({
  id: action.id, version: action.version, confirmed,
  values: { ...Object.fromEntries(action.fields.map(field => [field.name, field.value ?? ""])), ...overrides },
});
async function setup(entry: typeof cases[number]) {
  const { plugin, mock } = createMockPlugin(entry.factory(options), entry.fixture);
  const requests: { url: string; method: string; body?: unknown }[] = [];
  const runtime = createPluginRuntime([plugin], async (url, init) => {
    requests.push({ url, method: init.method ?? "GET", body: init.body });
    return mock.handle(new Request(url, init));
  });
  const connect = async () => {
    const session = runtime.createSession(), callback = `http://localhost:5179/api/plugins/callback/${plugin.id}`;
    const response = await mock.handle(new Request(runtime.connect(session, plugin.id, callback)));
    assert.equal(response.status, 303);
    await runtime.callback(session, plugin.id, callback, new URL(response.headers.get("location")!).searchParams);
    return session;
  };
  const session = await connect();
  return { runtime, plugin, mock, requests, session, connect,
    actions: async () => (await runtime.actions(session, plugin.id, entry.url)).actions,
    act: (operation: ActionRequest, requestId = randomUUID()) => runtime.act(session, plugin.id, entry.url, operation, requestId),
    html: async () => render((await runtime.read(session, plugin.id, entry.url)).view),
  };
}

for (const entry of cases) {
  test(`${entry.service}: URL-scoped create, read, update and confirmed delete through OAuth transport`, async () => {
    const host = await setup(entry), marker = `${entry.service} CRUD test`;
    const create = (await host.actions()).find(action => action.id === entry.create)!;
    await host.act(input(create, { body: marker }));
    assert((await host.html()).includes(marker));
    const update = (await host.actions()).find(action => action.id.startsWith(entry.update) && action.fields[0].value === marker)!;
    assert(update);
    await host.act(input(update, { body: `${marker} edited` }));
    assert((await host.html()).includes(`${marker} edited`));
    await assert.rejects(host.act(input(update, { body: "stale overwrite" })), { status: 409 });
    const remove = (await host.actions()).find(action => action.id.startsWith(entry.remove) && action.target.includes(`${marker} edited`))!;
    assert(remove);
    await assert.rejects(host.act(input(remove)), { status: 400 });
    assert((await host.html()).includes(`${marker} edited`));
    await host.act(input(remove, {}, true));
    assert(!(await host.html()).includes(marker));
    if (entry.service === "github") assert(host.requests.some(request => request.method === "DELETE"));
  });

  test(`${entry.service}: duplicate submissions write once, request ID conflicts fail, and sessions are isolated`, async () => {
    const host = await setup(entry), create = (await host.actions()).find(action => action.id === entry.create)!;
    const requestId = randomUUID(), operation = input(create, { body: "one logical write" });
    const before = host.requests.length;
    await Promise.all([host.act(operation, requestId), host.act(operation, requestId)]);
    const writes = host.requests.slice(before).filter(request => entry.service === "linear"
      ? String(request.body).includes("mutation CreateComment")
      : entry.service === "github" ? request.method === "POST" && request.url.includes("/comments")
        : request.url.endsWith("/chat.postMessage"));
    assert.equal(writes.length, 1);
    await assert.rejects(host.act(input(create, { body: "different payload" }), requestId), { status: 409 });
    const another = await host.connect();
    assert(!render((await host.runtime.read(another, host.plugin.id, entry.url)).view).includes("one logical write"));
    host.runtime.disconnect(host.session, host.plugin.id);
    await assert.rejects(host.act(operation), { status: 401 });
  });

  test(`${entry.service}: rejects fabricated IDs, extra target fields and invalid bodies before writing`, async () => {
    const plugin = entry.factory(options), fixture = entry.fixture();
    let writes = 0;
    const context: ActionContext = { user: users[entry.service], request: async (source, init) => {
      if ((entry.service === "linear" && String(object(init?.body).query).startsWith("mutation")) ||
        (entry.service === "github" && init?.method && init.method !== "GET") ||
        (entry.service === "slack" && /\/(chat\.|reactions\.(add|remove))/.test(source))) writes++;
      return fixture.request(source, init);
    } };
    const url = new URL(entry.url), create = (await plugin.actions(url, context)).find(action => action.id === entry.create)!;
    await assert.rejects(plugin.act(url, context, { id: `${entry.remove}foreign`, values: {}, confirmed: true }), { status: 403 });
    for (const values of [{ body: "ok", issueId: "elsewhere" }, { body: " " }, { body: "x".repeat(4001) }] as Record<string, string>[])
      await assert.rejects(plugin.act(url, context, { id: create.id, values }), { status: 400 });
    await assert.rejects(plugin.act(new URL("https://evil.example/resource"), context, input(create)), { status: 400 });
    assert.equal(writes, 0);
  });
}

for (const entry of cases.slice(0, 2)) test(`${entry.service}: inline updates send only the selected field and reject invalid partial changes`, async () => {
  const host = await setup(entry), id = entry.service === "linear" ? "issue.update" : "resource.update";
  const original = (await host.actions()).find(action => action.id === id)!;
  const state = entry.service === "linear" ? "done" : "closed";
  await host.act({ id, version: original.version, values: { state } });
  let current = (await host.actions()).find(action => action.id === id)!;
  assert.equal(current.fields.find(field => field.name === "title")!.value, original.fields.find(field => field.name === "title")!.value);
  assert.equal(current.fields.find(field => field.name === "body")!.value, original.fields.find(field => field.name === "body")!.value);
  const write = host.requests.find(request => entry.service === "linear" ? String(request.body).includes("mutation UpdateIssue") : request.method === "PATCH")!;
  const payload = JSON.parse(String(write.body));
  assert.deepEqual(entry.service === "linear" ? payload.variables.input : payload, entry.service === "linear" ? { stateId: state } : { state });
  await assert.rejects(host.act({ id, version: original.version, values: { title: "Stale title" } }), { status: 409 });
  for (const values of [{}, { title: " " }, { state: "invented" }, { body: "x".repeat(4001) }, { issueId: "elsewhere" }] as Record<string, string>[])
    await assert.rejects(host.act({ id, version: current.version, values }), { status: 400 });
  for (const values of [{ title: "Inline title" }, { body: "Inline body" }] as Record<string, string>[]) {
    await host.act({ id, version: current.version, values });
    current = (await host.actions()).find(action => action.id === id)!;
    assert.equal(current.fields.find(field => field.name === "state")!.value, state);
  }
  assert.match(await host.html(), /Inline title/); assert.match(await host.html(), /Inline body/);
});

test("Linear updates issue fields and state, then requires confirmation before deleting the URL target", async () => {
  const host = await setup(cases[0]);
  await host.act(input((await host.actions()).find(action => action.id === "issue.update")!, { title: "Updated issue", state: "done" }));
  assert.match(await host.html(), /Updated issue/); assert.match(await host.html(), /Done/);
  const remove = (await host.actions()).find(action => action.id === "issue.delete")!;
  await assert.rejects(host.act(input(remove)), { status: 400 });
  assert.equal((await host.act(input(remove, {}, true))).result.deleted, true);
  await assert.rejects(host.html(), { status: 404 });
});

test("GitHub reviews bind to the PR head; close/reopen remains scoped to that PR", async () => {
  const host = await setup(cases[1]);
  await host.act(input((await host.actions()).find(action => action.id === "review.create")!, { body: "Review through URL", event: "COMMENT" }));
  assert.match(await host.html(), /Review through URL/);
  const request = host.requests.find(request => request.method === "POST" && request.url.endsWith("/reviews"))!;
  assert.equal(JSON.parse(String(request.body)).commit_id, "abcdef1234");
  await host.act(input((await host.actions()).find(action => action.id === "resource.update")!, { state: "closed" }));
  assert(!(await host.actions()).some(action => action.id === "review.create"));
  await host.act(input((await host.actions()).find(action => action.id === "resource.update")!, { state: "open" }));
  assert((await host.actions()).some(action => action.id === "review.create"));
  assert(!(await host.actions()).some(action => action.id === "resource.delete"));
});

test("Slack reactions use the linked timestamp and replies always use the root thread", async () => {
  const plugin = createSlackPlugin(options), fixture = slackFixture(), context = { ...fixture, user: users.slack };
  const url = new URL("https://acme.slack.com/archives/C123/p1794129000000000?thread_ts=1794128400.000000");
  const actions = await plugin.actions(url, context);
  await plugin.act(url, context, input(actions.find(action => action.id === "reply.create")!, { body: "root-bound reply" }));
  await plugin.act(url, context, input(actions.find(action => action.id === "reaction.add")!, { emoji: "rocket" }));
  const result = object(await fixture.request("https://slack.com/api/conversations.replies?channel=C123&ts=1794128400.000000"));
  const messages = array(result.messages).map(object);
  assert.equal(messages.find(message => message.text === "root-bound reply")?.thread_ts, "1794128400.000000");
  assert(array(messages.find(message => message.ts === "1794129000.000000")!.reactions).map(object).some(reaction => reaction.name === "rocket"));
  await plugin.act(url, context, input(actions.find(action => action.id === "reaction.remove")!, { emoji: "rocket" }));
  assert(!actions.some(action => action.id.includes("message.delete/1794129000")));
});

test("write permissions and service errors propagate without retrying a mutation", async () => {
  const plugin = createLinearPlugin(options), fixture = linearFixture();
  let writes = 0;
  const context: ActionContext = { user: users.linear, request: async (url, init) => {
    if (String(object(init?.body).query).startsWith("mutation")) { writes++; throw new PluginError(403, "Denied"); }
    return fixture.request(url, init);
  } };
  const url = new URL(cases[0].url), action = (await plugin.actions(url, context))[0];
  await assert.rejects(plugin.act(url, context, input(action, { body: "test" })), { status: 403 });
  assert.equal(writes, 1);
});

test("OAuth refresh preserves edits and does not duplicate a write", async () => {
  const { plugin, mock } = createMockPlugin(createLinearPlugin(options), linearFixture);
  let exchanges = 0;
  const runtime = createPluginRuntime([plugin], async (url, init) => {
    const response = await mock.handle(new Request(url, init));
    if (url !== plugin.oauth.tokenUrl || !response.ok) return response;
    exchanges++;
    return Response.json({ ...await response.json(), expires_in: exchanges < 3 ? 1 : 3600 });
  });
  const session = runtime.createSession(), callback = "http://localhost:5179/api/plugins/callback/linear";
  const response = await mock.handle(new Request(runtime.connect(session, "linear", callback)));
  await runtime.callback(session, "linear", callback, new URL(response.headers.get("location")!).searchParams);
  await runtime.act(session, "linear", cases[0].url, { id: "comment.create", values: { body: "survives refresh" } }, randomUUID());
  const view = await runtime.read(session, "linear", cases[0].url);
  assert(render(view.view).includes("survives refresh")); assert.equal(exchanges, 3);
});

test("unsupported write URLs remain readable and cross-workspace actions never fetch", async () => {
  for (const [factory, fixture, user, readonly, other] of [
    [createSlackPlugin, slackFixture, users.slack, "https://acme.slack.com/files/U123/F123/notes.md", "https://other.slack.com/archives/C123/p1794128400000000"],
  ] as const) {
    const plugin = factory(options), data = fixture(); let calls = 0;
    const context: ActionContext = { user, request: (url, init) => { calls++; return data.request(url, init); } };
    assert.deepEqual(await plugin.actions(new URL(readonly), context), []);
    await assert.rejects(plugin.actions(new URL(other), context), { status: 403 });
    assert.equal(calls, 0);
    assert(render(await plugin.read(new URL(readonly), context)).length > 0);
  }
});

test("host CRUD endpoint requires same-origin JSON and an authenticated session", async () => {
  const { createPluginHandler } = await import(new URL("viewer/plugins.js", hostRoot).href) as {
    createPluginHandler(plugins: unknown[]): (req: IncomingMessage, res: ServerResponse) => Promise<boolean>;
  };
  const handler = createPluginHandler([createLinearPlugin(options)]);
  const request = async (origin: string, action: string, contentType = "application/json") => {
    const req = new PassThrough() as PassThrough & Partial<IncomingMessage>;
    req.url = "/api/plugins"; req.method = "POST"; req.headers = { host: "localhost:5179", origin, "content-type": contentType };
    Object.defineProperty(req, "socket", { value: { localPort: 5179 } });
    let status = 0, body = "";
    const res = { setHeader() {}, writeHead(value: number) { status = value; }, end(value: string) { body = value; } };
    const pending = handler(req as IncomingMessage, res as unknown as ServerResponse);
    req.end(JSON.stringify({ action, plugin: "linear", url: cases[0].url, requestId: randomUUID(), operation: { id: "issue.delete", values: {}, confirmed: true } }));
    await pending; return { status, body };
  };
  assert.equal((await request("https://evil.example", "act")).status, 403);
  assert.equal((await request("http://localhost:5179", "act", "text/plain")).status, 403);
  for (const action of ["read", "actions", "act"]) assert.equal((await request("http://localhost:5179", action)).status, 401);
});

test("host transports merge PUT and empty successful provider responses", async () => {
  const host = await setup(cases[1]);
  const merge = (await host.actions()).find(action => action.id === "pull.merge")!;
  await host.act(input(merge, { merge_method: "merge" }, true));
  assert(host.requests.some(request => request.method === "PUT" && request.url.endsWith("/merge")));
  const { fetchPluginJson } = await import(new URL("plugins/oauth.js", hostRoot).href);
  for (const status of [201, 202, 204]) assert.equal(await fetchPluginJson("https://api.github.com/repos/acme/docs/actions/runs/12/rerun", { method: "POST" }, false, async () => new Response(null, { status })), null);
});
