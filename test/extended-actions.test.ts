import { render } from "./render.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import { PluginError } from "@sasaki-s-sci/dooc-plugin";
import { createLinearPlugin, createGitHubPlugin } from "../src/index.js";
import { linearFixture, githubFixture } from "../dev/fixtures.js";
import { object } from "../src/common.js";
import type { ActionContext, UrlAction } from "../src/actions.js";
import { options, users } from "./fixtures.js";

function setup(service: "linear" | "github", source: string, override?: ActionContext["request"]) {
  const plugin = service === "linear" ? createLinearPlugin(options) : createGitHubPlugin(options);
  const fixture = service === "linear" ? linearFixture() : githubFixture();
  const requests: { url: string; method?: string; body?: unknown }[] = [];
  const context: ActionContext = { user: users[service], request: async (url, init) => {
    requests.push({ url, ...structuredClone(init) });
    return override ? override(url, init) : fixture.request(url, init);
  } };
  const url = new URL(source);
  const actions = () => plugin.actions(url, context);
  const act = (action: UrlAction, values: Record<string, string> = {}, confirmed = false) => plugin.act(url, context, { id: action.id, version: action.version, values, confirmed });
  const action = async (id: string) => { const item = (await actions()).find(a => a.id === id); assert(item, id); return item; };
  return { plugin, context, requests, url, actions, act, action, html: async () => render(await plugin.read(url, context)) };
}
const linearUrl = "https://linear.app/acme/issue/DOC-42";
const pullUrl = "https://github.com/acme/docs/pull/42";

test("Linear properties use provider enums, clear nullable values, and reject malformed or stale edits", async () => {
  const host = setup("linear", linearUrl), original = await host.action("issue.update");
  await host.act(original, { assigneeId: "ben-id", priority: "1", labelIds: '["label-viewer"]', dueDate: "2026-12-01", estimate: "5", cycleId: "", projectId: "" });
  const mutation = host.requests.find(r => String(object(r.body).query).startsWith("mutation UpdateIssue"))!;
  assert.deepEqual(object(object(mutation.body).variables).input, { assigneeId: "ben-id", priority: 1, labelIds: ["label-viewer"], dueDate: "2026-12-01", estimate: 5, cycleId: null, projectId: null });
  assert.match(await host.html(), /Ben Park/);
  await assert.rejects(host.act(original, { title: "stale" }), { status: 409 });
  const current = await host.action("issue.update");
  const invalid: Record<string, string>[] = [{ assigneeId: "outside-team" }, { labelIds: '["foreign"]' }, { labelIds: '["label-viewer","label-viewer"]' }, { labelIds: '{}' }, { priority: "6" }, { dueDate: "2026-02-30" }, { estimate: "NaN" }, { estimate: "2.5" }, { estimate: "-1" }];
  for (const values of invalid) await assert.rejects(host.act(current, values), { status: 400 });
  await host.act(current, { assigneeId: "", dueDate: "", estimate: "", labelIds: "[]" });
  assert.equal((await host.action("issue.update")).fields.find(f => f.name === "labelIds")!.value, "[]");
  let calls = 0;
  await assert.rejects(host.plugin.actions(new URL("https://linear.app/foreign/issue/DOC-42"), { user: users.linear, request: async () => { calls++; return {}; } }), { status: 403 });
  assert.equal(calls, 0);
});

test("Linear project and cycle URLs update their own resource and validate date order", async () => {
  const project = setup("linear", "https://linear.app/acme/project/viewer-abcdef123456");
  await project.act(await project.action("resource.update"), { name: "Updated project", targetDate: "2026-12-10", leadId: "ben-id", statusId: "project-done" });
  await project.act(await project.action("projectUpdate.create"), { body: "Shipping", health: "onTrack" });
  for (const text of ["Updated project", "2026-12-10", "Ben Park", "Shipping"]) assert((await project.html()).includes(text));
  const cycle = setup("linear", "https://linear.app/acme/team/DOC/cycle/42"), edit = await cycle.action("resource.update");
  await assert.rejects(cycle.act(edit, { startsAt: "2026-12-10", endsAt: "2026-12-09" }), { status: 400 });
  await cycle.act(edit, { startsAt: "2026-12-01", endsAt: "2026-12-14" });
  assert.match(await cycle.html(), /2026-12-14/);
});

test("GitHub properties, draft transitions, and SHA-bound merge use the URL's repository", async () => {
  const host = setup("github", pullUrl);
  await host.act(await host.action("properties.update"), { assignees: '["ben-park"]', labels: '["Viewer"]', milestone: "1" });
  const patch = host.requests.find(r => r.method === "PATCH")!;
  assert.equal(new URL(patch.url).pathname, "/repos/acme/docs/issues/42");
  assert.deepEqual(patch.body, { assignees: ["ben-park"], labels: ["Viewer"], milestone: 1 });
  await assert.rejects(host.act(await host.action("properties.update"), { assignees: '["foreign"]' }), { status: 400 });
  await host.act(await host.action("pull.draft"));
  assert(!(await host.actions()).some(a => a.id === "pull.merge"));
  await host.act(await host.action("pull.draft"));
  const merge = await host.action("pull.merge");
  await assert.rejects(host.act(merge, { merge_method: "merge" }), { status: 400 });
  await host.act(merge, { merge_method: "squash" }, true);
  const request = host.requests.find(r => r.url.endsWith("/merge"))!;
  assert.equal(request.method, "PUT"); assert.deepEqual(request.body, { sha: "abcdef1234", merge_method: "squash" });
  assert(!(await host.actions()).some(a => a.id === "pull.merge"));
  assert(!(await host.action("resource.update")).fields.some(f => f.name === "state"));
});

test("GitHub hides privileged actions without repository permission and refuses a changed PR head", async () => {
  const fixture = githubFixture(); let permitted = false, changed = false;
  const host = setup("github", pullUrl, async (url, init) => {
    const result = await fixture.request(url, init);
    if (url === "https://api.github.com/repos/acme/docs") return { ...object(result), permissions: { push: permitted } };
    if (url.endsWith("/pulls/42")) return { ...object(result), head: { ...object(object(result).head), sha: changed ? "changed-sha" : "abcdef1234" } };
    return result;
  });
  assert(!(await host.actions()).some(a => ["pull.merge", "properties.update", "reviewers.add"].includes(a.id)));
  permitted = true; const merge = await host.action("pull.merge"); changed = true;
  await assert.rejects(host.act(merge, { merge_method: "merge" }, true), { status: 409 });
  assert(!host.requests.some(r => r.method === "PUT"));
});

test("GitHub Actions cancel and rerun catalogs follow the run state", async () => {
  const host = setup("github", "https://github.com/acme/docs/actions/runs/12"), cancel = await host.action("run.cancel");
  await assert.rejects(host.act(cancel), { status: 400 });
  await host.act(cancel, {}, true);
  assert(!(await host.actions()).some(a => a.id === "run.cancel"));
  const rerun = await host.action("run.rerun"); await host.act(rerun);
  assert((await host.actions()).some(a => a.id === "run.cancel"));
  await assert.rejects(host.act(rerun), { status: 403 });
  assert.deepEqual(host.requests.filter(r => r.method === "POST").map(r => new URL(r.url).pathname), ["/repos/acme/docs/actions/runs/12/cancel", "/repos/acme/docs/actions/runs/12/rerun"]);
});

test("GitHub file edits preserve SHA and branch binding, support empty files, and confirm deletion", async () => {
  const host = setup("github", "https://github.com/acme/docs/blob/main/src/index.ts"), edit = await host.action("file.update");
  await host.act(edit, { body: "", message: "Empty file" });
  const write = host.requests.find(r => r.method === "PUT")!;
  assert.deepEqual(write.body, { content: "", message: "Empty file", sha: "file-sha-1", branch: "main" });
  await assert.rejects(host.act(edit, { body: "stale", message: "Overwrite" }), { status: 409 });
  const remove = await host.action("file.delete");
  await assert.rejects(host.act(remove, { message: "Remove" }), { status: 400 });
  assert.equal((await host.act(remove, { message: "Remove" }, true)).deleted, true);
});

test("GitHub Project field edits reject foreign items/options and retain field versions", async () => {
  const host = setup("github", "https://github.com/orgs/acme/projects/1");
  const field = await host.action("item.field/I2/status-field");
  await assert.rejects(host.act(field, { value: "foreign-option" }), { status: 400 });
  await assert.rejects(host.plugin.act(host.url, host.context, { id: "item.field/foreign/status-field", values: { value: "done" } }), { status: 403 });
  await host.act(field, { value: "done" });
  await assert.rejects(host.act(field, { value: "todo" }), { status: 409 });
  await host.act(await host.action("item.field/I2/status-field"), { value: "" });
  await host.act(await host.action("resource.update"), { title: "Release project", closed: "true" });
  assert.match(await host.html(), /Release project/);
  await host.act(await host.action("draft.create"), { title: "New draft", body: "Body" });
  assert.match(await host.html(), /New draft/);
  const archive = await host.action("item.archive/I2"); await host.act(archive);
  assert.equal((await host.action("item.archive/I2")).label, "復元");
});

test("Workflow forms derive typed inputs from YAML and reject unlisted input values", async () => {
  const writes: unknown[] = [];
  const yaml = `name: Deploy\non:\n  workflow_dispatch:\n    inputs:\n      stage:\n        type: choice\n        options: [staging, production]\n        required: true\n      dry_run:\n        type: boolean\n        default: true\n      count:\n        type: number\n        default: 2\njobs: {}\n`;
  const host = setup("github", "https://github.com/acme/docs/actions/workflows/ci.yml", async (source, init) => {
    const path = new URL(source).pathname;
    if (init?.method === "POST" || init?.method === "PUT") { writes.push(init.body); return null; }
    if (path === "/repos/acme/docs") return { default_branch: "main", permissions: { push: true } };
    if (path.endsWith("/branches")) return [{ name: "main" }];
    if (path.includes("/contents/")) return { sha: "workflow-sha", encoding: "base64", content: Buffer.from(yaml).toString("base64") };
    if (path.endsWith("/workflows/ci.yml")) return { name: "Deploy", path: ".github/workflows/ci.yml", state: "active" };
    throw new PluginError(404, "Unexpected route");
  });
  const dispatch = await host.action("workflow.dispatch");
  assert(!dispatch.fields.some(f => f.name === "inputs"));
  const values = { ref: "main", "input:stage": "production", "input:dry_run": "true", "input:count": "3" };
  await assert.rejects(host.act(dispatch, { ...values, "input:stage": "foreign" }), { status: 400 });
  await host.act(dispatch, values);
  assert.deepEqual(writes, [{ ref: "main", inputs: { stage: "production", dry_run: "true", count: "3" } }]);
});

test("GitHub review replies and edits, and reactions, stay bound to the current PR and author", async () => {
  const host = setup("github", pullUrl);
  await host.act(await host.action("review.create"), { event: "COMMENT", body: "Own review" });
  const edit = (await host.actions()).find(a => a.id.startsWith("review.update/"))!;
  await host.act(edit, { body: "Edited review" });
  assert(host.requests.some(r => r.method === "PUT" && /\/pulls\/42\/reviews\/\d+$/.test(r.url)));
  await assert.rejects(host.act(edit, { body: "stale" }), { status: 409 });
  assert(!(await host.actions()).some(a => a.id.startsWith("review.delete/")));
  await host.act(await host.action("reviewComment.reply/3"), { body: "Line reply" });
  const line = (await host.actions()).find(a => a.id.startsWith("reviewComment.update/"))!;
  await host.act(line, { body: "Edited line reply" });
  await host.act(await host.action(line.id.replace(".update/", ".delete/")), {}, true);
  await host.act(await host.action("issueReaction.add"), { content: "eyes" });
  const remove = (await host.actions()).find(a => a.id.startsWith("issueReaction.delete/") && a.label.includes("eyes"))!;
  await host.act(remove);
  assert(!(await host.actions()).some(a => a.id === "review.update/1"));
  await assert.rejects(host.plugin.act(host.url, host.context, { id: "issueReaction.delete/1", values: {} }), { status: 403 });
});
