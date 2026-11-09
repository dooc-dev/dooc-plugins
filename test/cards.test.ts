import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { PluginError } from "@dooc-dev/dooc-plugin";
import type { PluginBlock } from "@dooc-dev/dooc-plugin";
import { createGitHubPlugin, createLinearPlugin, createSlackPlugin } from "../src/index.js";
import { view } from "../src/common.js";
import { githubFixture, linearFixture, slackFixture } from "../dev/fixtures.js";
import { options, users, slackContext } from "./fixtures.js";
import { render } from "./render.js";

const flatten = (blocks: PluginBlock[]): PluginBlock[] => blocks.flatMap(block => [block, ...(block.type === "columns" ? flatten([...block.main, ...block.aside]) : block.type === "section" ? flatten(block.blocks) : [])]);
test("Linear blocks preserve ownership, dates, sub-issues, links and editable properties", async () => {
  const result = await createLinearPlugin(options).read(new URL("https://linear.app/acme/issue/DOC-42"), { ...linearFixture(), user: users.linear });
  const html = render(result);
  for (const text of ["Knowledge Hub", "Ada Mori", "High", "2026-11-12", "DOC-43", "DOC-45", "Sub-issues (3)", "Comments (2)"]) assert(html.includes(text), text);
  assert.match(html, /<strong>受け入れ条件<\/strong>/);
  assert.match(render(result.collapsed), /In progress/);
  assert.equal(result.header?.reference, "DOC-42");
  assert.equal(result.blocks[0].type, "columns");
  assert(flatten(result.blocks).some(block => block.type === "fields" && block.items.some(field => field.edit?.action === "issue.update" && field.edit.field === "dueDate")));
  for (const id of ["DOC-43", "DOC-44", "DOC-45"]) assert(html.includes(`href="https://linear.app/acme/issue/${id}" target="_blank" rel="noopener noreferrer"`));
  const project = await createLinearPlugin(options).read(new URL("https://linear.app/acme/project/viewer-abcdef123456/overview"), { ...linearFixture(), user: users.linear });
  assert(flatten(project.blocks).some(block => block.type === "progress" && block.value === 75));
});
test("GitHub preserves PR authors, latest review decisions, CI state, branches and diff", async () => {
  const result = await createGitHubPlugin(options).read(new URL("https://github.com/acme/docs/pull/42"), { ...githubFixture(), user: users.github });
  const html = render(result);
  for (const text of ["Ben Park", "ada-mori", "2/3 checks passed", "Reviews: 1/1 approved", "feat/preview-cards", "main", "+136", "−4", "Changed files / diff (3)", "src/slack.ts"]) assert(html.includes(text), text);
  assert.match(html, /data-tone="success"/); assert.match(html, /data-tone="danger"/);
  assert.equal(result.header?.reference, "#42");
  const reviews = view({ service: "GitHub", title: "PR", sections: [{ title: "Reviews", data: [
    { id: 1, user: { id: 7, login: "ada" }, state: "APPROVED", body: "Approved" },
    { id: 2, user: { id: 7, login: "ada" }, state: "CHANGES_REQUESTED", body: "Change needed" },
    { id: 3, user: { id: 7, login: "ada" }, state: "COMMENTED", body: "Comment" },
  ] }] });
  assert.match(render(reviews), /Reviews: 0\/1 approved/);
  const draft = render(view({ service: "GitHub", kind: "pull", title: "#1 Draft work", metadata: { State: "open", Draft: true } }));
  assert.match(draft, />Draft</); assert(!draft.includes('>open<'));
});
test("Slack preserves named threads, attachments and authenticated reaction bindings", async () => {
  const result = await createSlackPlugin(options).read(new URL("https://acme.slack.com/archives/C123/p1794128400000000"), { ...slackFixture(), user: users.slack });
  const html = render(result);
  for (const text of ["Ada Mori", "Ben Park", "Mina Ito", "2026-11-08 09:10 UTC", "Thread (2)", "Files (1)", "QA checklist", "👀 3", "👍 2"]) assert(html.includes(text), text);
  assert.equal(html.match(/プレビューカードの確認をお願いします/g)?.length, 1);
  assert(!html.includes("U124")); assert(!html.includes("<iframe"));
  assert(flatten(result.blocks).some(block => block.type === "message" && block.reactions?.some(reaction => reaction.action === "reaction.remove" || reaction.action === "reaction.add")));
  const context = slackContext((method, params) => { if (method === "users.info" && params.get("user") === "U124") throw new PluginError(403, "No profile access"); });
  const partial = await createSlackPlugin(options).read(new URL("https://acme.slack.com/archives/C123/p1700000000123456"), context);
  assert.match(render(partial), /Ready/); assert.match(render(partial), /U124/);
  assert.equal(context.calls.filter(call => call.url.pathname.endsWith("users.info") && call.url.searchParams.get("user") === "U124").length, 1);
});
test("Untrusted content stays data until the host renders it, including titles, edits and links", () => {
  const result = view({ service: "GitHub", title: '<img src=x onerror="alert(1)">', body: '**Hello** `<script>`\n[unsafe](javascript:alert)', sections: [
    { title: "Changed files / diff", data: [{ filename: '<svg onload="alert(1)">', patch: '+<script>alert(1)</script>\n-<img onerror="x">' }] },
    { title: "Comments", data: [{ id: 'id" onclick="alert(1)', body: "Body", user: "Alice" }] },
  ] });
  assert(!("format" in result)); assert(!("html" in result));
  const html = render(result);
  assert.match(html, /<strong>Hello<\/strong>/); assert.match(html, /&lt;script&gt;/);
  assert(!/<(?:script|img)\b|<svg onload=/.test(html)); assert(!html.includes('href="javascript:')); assert(!html.includes(' onclick="'));
  const issue = { service: "Linear", title: "Parent", sections: [{ title: "Sub-issues", data: [{ identifier: "DOC-7", title: "Child", url: "https://evil.example" }] }] };
  assert.match(render(view({ ...issue, sourceUrl: "https://linear.app/my-team/issue/DOC-42" })), /href="https:\/\/linear\.app\/my-team\/issue\/DOC-7"/);
  assert(!render(view(issue)).includes('href="https://evil.example'));
});
test("Large fields cannot consume the title, and project table cells retain action bindings", () => {
  const large = view({ service: "Linear", title: "Keep this title", sections: [{ title: "Details", data: { content: "x".repeat(200_000) } }] });
  assert.match(render(large), /Keep this title/); assert.match(render(large), /shortened/);
  assert(Buffer.byteLength(JSON.stringify(large)) < 2 * 1024 * 1024);
  const project = view({ service: "GitHub", kind: "project", title: "Project", sections: [
    { title: "Details", data: { fields: { nodes: [{ id: "status", name: "Status", dataType: "SINGLE_SELECT" }] } } },
    { title: "Items", data: [{ id: "item-1", title: "Issue", fieldValues: { nodes: [] } }, { id: "item-2", title: "Draft", body: "Draft body", fieldValues: { nodes: [{ name: "Todo", field: { id: "status", name: "Status" } }] } }] },
  ] });
  const table = flatten(project.blocks).find(block => block.type === "table" && block.headers.includes("Status"));
  assert(table?.type === "table");
  assert(table.rows[0].cells.some(cell => cell.edit?.action === "item.field/item-1/status"));
  assert(table.rows[1].actions?.includes("item.delete/item-2"));
  assert.match(render(project), /Draft body/); assert(!render(project).includes("[object Object]"));
});
test("Official brand originals remain intact and are delivered as inert theme variants", () => {
  const manifest = JSON.parse(readFileSync(new URL("../../assets/brands/sources.json", import.meta.url), "utf8"));
  for (const asset of manifest.assets) {
    const bytes = readFileSync(new URL(`../../assets/brands/${asset.file}`, import.meta.url));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), asset.sha256);
    const service = asset.file.startsWith("linear") ? "Linear" : asset.file.startsWith("github") ? "GitHub" : "Slack";
    const icon = view({ service, title: "Icon" }).header?.icon;
    const uri = asset.file.includes("dark") ? icon?.dark : icon?.light;
    assert(uri); assert(uri.startsWith("data:image/svg+xml;base64,"));
    assert.deepEqual(Buffer.from(uri.split(",")[1], "base64"), bytes);
  }
});
