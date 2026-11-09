import { render } from "./render.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import { PluginError } from "@dooc-dev/dooc-plugin";
import { createGitHubPlugin, createLinearPlugin, createSlackPlugin } from "../src/index.js";
import { view } from "../src/common.js";
import { githubContext, linearContext, slackContext, options, page, resource, users } from "./fixtures.js";

const github = createGitHubPlugin(options), linear = createLinearPlugin(options), slack = createSlackPlugin(options);
const cases = [
  [github, githubContext, [
    "https://github.com/ada", "https://github.com/acme/docs", "https://github.com/acme/docs/issues", "https://github.com/acme/docs/pulls?q=is%3Aopen",
    "https://github.com/acme/docs/issues/42#issuecomment-3", "https://github.com/acme/docs/pull/42/files", "https://github.com/acme/docs/commit/abcdef1234",
    "https://github.com/acme/docs/compare/main...feature/test", "https://github.com/acme/docs/blob/main/src/index.ts#L1-L4", "https://github.com/acme/docs/tree/main",
    "https://github.com/acme/docs/releases", "https://github.com/acme/docs/releases/tag/v1.0", "https://github.com/acme/docs/releases/latest", "https://github.com/acme/docs/tags",
    "https://github.com/acme/docs/branches", "https://github.com/acme/docs/commits", "https://github.com/acme/docs/actions", "https://github.com/acme/docs/actions/runs/12",
    "https://github.com/acme/docs/actions/runs/12/job/34", "https://github.com/acme/docs/discussions/42", "https://gist.github.com/ada/abcdef", "https://gist.github.com/ada/abcdef/abcd",
    "https://github.com/orgs/acme/projects/1/views/2", "https://github.com/users/ada/projects/1", "https://github.com/acme/docs/milestones", "https://github.com/acme/docs/milestone/3", "https://github.com/acme/docs/actions/workflows/ci.yml",
  ]],
  [linear, linearContext, [
    "https://linear.app/acme/issue/DOC-42/improve-previews", "https://linear.app/acme/project/viewer-abcdef123456/overview",
    "https://linear.app/acme/project/00000000-0000-0000-0000-000000000001", "https://linear.app/acme/team/DOC/all",
    "https://linear.app/acme/team/DOC/cycle/42", "https://linear.app/acme/team/DOC/cycles/current",
    "https://linear.app/acme/team/DOC/cycle/00000000-0000-0000-0000-000000000001",
    "https://linear.app/acme/document/guide-abcdef123456", "https://linear.app/acme/project/viewer-abcdef123456/document/guide-abcdef123456",
    "https://linear.app/acme/initiative/launch-abcdef123456/overview", "https://linear.app/acme/view/my-work-abcdef123456",
  ]],
  [slack, slackContext, [
    "https://acme.slack.com/archives/C123/p1700000000123456", "https://acme.slack.com/archives/C123/p1700000001000001?thread_ts=1700000000.123456",
    "https://acme.slack.com/archives/C123", "https://acme.slack.com/team/U123", "https://acme.slack.com/files/U123/F123/notes.txt",
    "https://files.slack.com/files-pri/T123-F123/notes.txt", "https://acme.slack.com/docs/T123/F123", "https://app.slack.com/canvas/T123/F123",
    "https://acme.slack.com/search?q=release", "https://app.slack.com/client/T123", "https://app.slack.com/client/T123/C123",
    "https://app.slack.com/client/T123/C123/1700000000.123456", "https://app.slack.com/client/T123/C123/thread/C123-1700000000.123456",
    "https://app.slack.com/client/T123/search?q=release",
  ]],
] as const;

for (const [plugin, makeContext, urls] of cases) {
  for (const source of urls) test(`${plugin.id} reads ${source}`, async () => {
    const url = new URL(source), context = makeContext();
    assert.equal(plugin.matches(url), true);
    const result = await plugin.read(url, context);
    assert(!("format" in result)); assert(Array.isArray(result.blocks));
    assert(!("format" in result.collapsed)); assert.match(render(result), /plugin-block-heading/);
    assert(!render(result).includes(options.clientSecret));
    assert(context.calls.length > 0);
    assert(!render(result).includes("Unavailable"));
  });
  test(`${plugin.id} rejects lookalike hosts, credentials and unsupported routes before fetching`, async () => {
    const valid = new URL(urls[0]);
    const invalid = [
      new URL(valid.href.replace("https:", "http:")), new URL(valid.href.replace(valid.hostname, `${valid.hostname}.evil.example`)),
      new URL(valid.href.replace("https://", "https://name:password@")), new URL(valid.href.replace(valid.hostname, `${valid.hostname}:8443`)),
      new URL(`https://${valid.hostname}/%E0%A4%A`), new URL(`https://${valid.hostname}/unsupported` + (plugin.id === "github" ? "/path/unsupported" : "")),
    ];
    for (const url of invalid) {
      assert.equal(plugin.matches(url), false, url.href);
      const context = makeContext();
      await assert.rejects(plugin.read(url, context), error => error instanceof PluginError && error.status === 400);
      assert.equal(context.calls.length, 0);
    }
  });
  test(`${plugin.id} identifies the actual user`, async () => {
    assert.deepEqual(await plugin.identifyUser(makeContext()), users[plugin.id as keyof typeof users]);
  });
}

test("GitHub PR includes reviews, patches, commit checks, timeline and status", async () => {
  const context = githubContext();
  const result = await github.read(new URL("https://github.com/acme/docs/pull/42"), context);
  for (const section of ["Comments", "Reactions", "Timeline", "Reviews", "Review comments", "Changed files / diff", "Commits", "Checks", "Commit status"]) assert(render(result).includes(section));
  assert(context.calls.some(call => call.url.pathname.endsWith("/commits/abcdef1234/check-runs")));
});

test("GitHub resolves a branch containing slashes and decodes UTF-8 file content", async () => {
  const context = githubContext(url => {
    if (url.pathname.includes("/contents")) {
      if (url.searchParams.get("ref") !== "feature/viewer") throw new PluginError(502, "Not found");
      assert.equal(url.pathname, "/repos/acme/docs/contents/src/index.ts");
      return { encoding: "base64", content: Buffer.from("日本語のファイル").toString("base64") };
    }
  });
  const result = await github.read(new URL("https://github.com/acme/docs/blob/feature/viewer/src/index.ts"), context);
  assert.match(render(result), /日本語のファイル/);
});

test("GitHub file lookup stops on permission errors and preserves binary-file metadata", async () => {
  const context = githubContext(() => { throw new PluginError(403, "Denied"); });
  await assert.rejects(github.read(new URL("https://github.com/acme/docs/blob/main/a/b/c"), context), error => error instanceof PluginError && error.status === 403);
  assert.equal(context.calls.length, 1);
  const binary = await github.read(new URL("https://github.com/acme/docs/blob/main/file.bin"), githubContext(() => ({ encoding: "base64", content: "AAEC", size: 3 })));
  assert.match(render(binary), /Binary, large/);
});

test("GitHub paginates and marks capped collections", async () => {
  const context = githubContext(() => Array.from({ length: 30 }, (_, i) => ({ title: `Issue ${i}` })));
  const result = await github.read(new URL("https://github.com/acme/docs/issues"), context);
  assert.deepEqual(context.calls.map(call => call.url.searchParams.get("page")), ["1", "2", "3"]);
  assert.match(render(result), /Preview limit reached/);
});

test("A failed later page preserves the earlier items", async () => {
  const context = githubContext(url => {
    if (url.searchParams.get("page") === "2") throw new PluginError(429, "Rate limited");
    return Array.from({ length: 30 }, () => ({ title: "Saved item" }));
  });
  const result = await github.read(new URL("https://github.com/acme/docs/issues"), context);
  assert.match(render(result), /Saved item/); assert.match(render(result), /Only part of this collection/);
});

test("Optional failures leave the primary card intact; authentication failures propagate", async () => {
  const url = new URL("https://github.com/acme/docs/pull/42");
  const denied = githubContext(url => { if (url.pathname.endsWith("/reviews")) throw new PluginError(403, "Denied"); });
  const result = await github.read(url, denied);
  assert.match(render(result), /Improve previews/); assert.match(render(result), /Unavailable \(403\)/);
  const expired = githubContext(url => { if (url.pathname.endsWith("/reviews")) throw new PluginError(401, "Expired"); });
  await assert.rejects(github.read(url, expired), error => error instanceof PluginError && error.status === 401);
});

test("GitHub rejects application identities", async () => {
  await assert.rejects(github.identifyUser(githubContext(() => ({ id: 7, login: "bot", type: "Bot" }))), error => error instanceof PluginError && error.status === 403);
});

test("Linear resolves a project slug with a filter and fetches all related sections by its UUID", async () => {
  const context = linearContext();
  const result = await linear.read(new URL("https://linear.app/acme/project/viewer-abcdef123456"), context);
  assert.match(context.calls[0].init.body.query, /projects\(filter: \{ slugId/);
  assert.equal(context.calls[0].init.body.variables.id, "abcdef123456");
  for (const call of context.calls.slice(1)) assert.equal(call.init.body.variables.id, resource.id);
  for (const section of ["Issues", "Project updates", "Milestones", "Documents", "Members", "Teams", "Comments"]) assert(render(result).includes(section));
});

test("Linear follows cursors even when a page has fewer than 30 items", async () => {
  const context = linearContext((query, variables) => {
    if (query.includes("collection: comments")) return { data: { resource: { collection: variables.after ? page([{ body: "Second page" }]) : page([{ body: "First page" }], "next") } } };
  });
  const result = await linear.read(new URL("https://linear.app/acme/issue/DOC-42"), context);
  assert.match(render(result), /Second page/);
  assert(context.calls.some(call => call.init.body.variables.after === "next"));
});

test("Linear scopes numeric cycles to their team", async () => {
  const context = linearContext();
  await linear.read(new URL("https://linear.app/acme/team/DOC/cycle/42"), context);
  assert.deepEqual(context.calls[0].init.body.variables, { team: "DOC", number: 42 });
});

test("Linear and Slack reject a different workspace before requesting any data", async () => {
  for (const [plugin, source, context] of [
    [linear, "https://linear.app/other/issue/DOC-42", linearContext()],
    [slack, "https://other.slack.com/archives/C123", slackContext()],
    [slack, "https://app.slack.com/client/T999/C123", slackContext()],
    [slack, "https://files.slack.com/files-pri/T999-F123/file.txt", slackContext()],
    [slack, "https://other.slack.com/docs/T123/F123", slackContext()],
  ] as const) {
    await assert.rejects(plugin.read(new URL(source), context), error => error instanceof PluginError && error.status === 403);
    assert.equal(context.calls.length, 0);
  }
});

test("Linear rejects app identities, missing resources and GraphQL errors without exposing remote messages", async () => {
  await assert.rejects(linear.identifyUser(linearContext(() => ({ data: { viewer: { id: "app", name: "Bot", app: true, active: true, organization: { id: "org", urlKey: "acme" } } } }))), error => error instanceof PluginError && error.status === 403);
  await assert.rejects(linear.read(new URL("https://linear.app/acme/project/project-abcdef123456"), linearContext(() => ({ data: { resource: { nodes: [] } } }))), error => error instanceof PluginError && error.status === 404);
  for (const [code, status] of [["UNAUTHENTICATED", 401], ["FORBIDDEN", 403], ["OTHER", 502]]) {
    await assert.rejects(linear.identifyUser(linearContext(() => ({ errors: [{ message: "secret-token", extensions: { code } }] }))), error => error instanceof PluginError && error.status === status && !error.message.includes("secret-token"));
  }
});

test("Slack OAuth uses user scopes and selects/refreshes only user tokens", () => {
  assert.equal(slack.oauth.clientSecret, undefined);
  assert.equal(slack.oauth.scopeParameter, "user_scope");
  assert(slack.oauth.scopes.includes("chat:write"));
  assert(slack.oauth.scopes.includes("reactions:write"));
  const token = { access_token: "xoxp-user", token_type: "user", refresh_token: "xoxe-refresh", expires_in: 3600 };
  assert.equal(slack.oauth.parseToken!({ ok: true, token_type: "bot", access_token: "xoxb-bot", authed_user: token }).access_token, "xoxp-user");
  assert.equal(slack.oauth.parseToken!({ ok: true, ...token }).refresh_token, "xoxe-refresh");
  assert.throws(() => slack.oauth.parseToken!({ ok: true, token_type: "bot", access_token: "xoxb-bot" }));
  assert.throws(() => slack.oauth.parseToken!({ ok: false, error: "invalid_auth" }));
});

test("Slack preserves exact timestamps and fetches the thread once for a reply permalink", async () => {
  const context = slackContext();
  const result = await slack.read(new URL("https://acme.slack.com/archives/C123/p1700000001000001?thread_ts=1700000000.123456"), context);
  const calls = context.calls.filter(call => call.url.pathname.endsWith("conversations.replies"));
  assert.equal(calls.length, 1); assert.equal(calls[0].url.searchParams.get("ts"), "1700000000.123456");
  assert.match(render(result), /Ready/); assert.match(render(result), /Thread/);
});

test("Slack shows the linked reply beyond the first thread page", async () => {
  const context = slackContext((method, params) => {
    if (method === "conversations.replies") return params.has("oldest")
      ? { ok: true, messages: [{ ts: "1700000001.000001", text: "Linked reply", thread_ts: "1700000000.123456" }] }
      : { ok: true, messages: [{ ts: "1700000000.123456", text: "Parent" }], has_more: true, response_metadata: { next_cursor: "next" } };
  });
  const result = await slack.read(new URL("https://acme.slack.com/archives/C123/p1700000001000001?thread_ts=1700000000.123456"), context);
  assert.match(render(result), /Linked reply/); assert.match(render(result), /Preview limit reached/);
});

test("Slack never substitutes a different message for a deleted permalink", async () => {
  await assert.rejects(slack.read(new URL("https://acme.slack.com/archives/C123/p1700000009999999"), slackContext()), error => error instanceof PluginError && error.status === 404);
});

test("Slack falls back to history for system messages that cannot have a thread", async () => {
  const context = slackContext(method => { if (method === "conversations.replies") return { ok: false, error: "thread_not_found" }; });
  const result = await slack.read(new URL("https://acme.slack.com/archives/C123/p1700000000123456"), context);
  assert.match(render(result), /Launch/);
});

test("Slack reports body-level permission and rate errors, and rejects bot identities", async () => {
  for (const [error, status] of [["invalid_auth", 401], ["missing_scope", 403], ["channel_not_found", 404], ["ratelimited", 429]]) {
    await assert.rejects(slack.identifyUser(slackContext(() => ({ ok: false, error }))), value => value instanceof PluginError && value.status === status);
  }
  await assert.rejects(slack.identifyUser(slackContext(method => method === "auth.test" ? { ok: true, bot_id: "B123", user_id: "U123", team_id: "T123" } : undefined)), error => error instanceof PluginError && error.status === 403);
});

test("Slack caps history at one page and shows member pagination", async () => {
  const context = slackContext((method, params) => {
    if (method === "conversations.history") return { ok: true, messages: [{ text: "Latest message" }], has_more: true, response_metadata: { next_cursor: "older" } };
    if (method === "conversations.members") return { ok: true, members: [params.get("cursor") ? "U456" : "U123"], response_metadata: { next_cursor: params.get("cursor") ? "" : "next" } };
  });
  const result = await slack.read(new URL("https://acme.slack.com/archives/C123"), context);
  assert.match(render(result), /U456/); assert.match(render(result), /Preview limit reached/);
  assert.equal(context.calls.filter(call => call.url.pathname.endsWith("conversations.history")).length, 1);
});

test("Slack search handles collections with different page counts without repeating files", async () => {
  const context = slackContext((method, params) => {
    if (method === "search.all") return { ok: true,
      messages: { matches: [{ text: `Result ${params.get("page")}` }], paging: { pages: 2 } },
      files: { matches: [{ title: "Only file" }], paging: { pages: 1 } },
    };
  });
  const result = await slack.read(new URL("https://acme.slack.com/search?q=release"), context);
  assert.match(render(result), /Messages \(2\)/); assert.match(render(result), /Files \(1\)/);
  assert.equal(context.calls.length, 2);
});

test("Views escape provider HTML, reject dangerous links, and stay under the SDK size limit", () => {
  const result = view({ service: "Test", title: '<img src=x onerror="alert(1)">', body: "<script>alert(1)</script>", sections: [{ title: "Data", data: Array.from({ length: 1000 }, () => ({ title: "click", url: "javascript:alert(1)", body: "<&>\"'日本語".repeat(10_000) })) }] });
  assert(!render(result).includes("<script>")); assert(!render(result).includes("<img")); assert(!render(result).includes('href="javascript:'));
  assert.match(render(result), /&lt;script&gt;/); assert.match(render(result), /shortened/);
  assert(Buffer.byteLength(JSON.stringify(result)) < 2 * 1024 * 1024);
});

test("Viewer entrypoint loads only configured plugins and rejects incomplete configuration", async () => {
  const keys = Object.keys(process.env).filter(key => /^DOOC_(LINEAR|SLACK|GITHUB)_CLIENT_/.test(key));
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    for (const key of keys) delete process.env[key];
    await assert.rejects(import(new URL("../src/viewer.js?none", import.meta.url).href), /Configure at least one/);
    process.env.DOOC_GITHUB_CLIENT_ID = "client";
    await assert.rejects(import(new URL("../src/viewer.js?incomplete", import.meta.url).href), /Set both/);
    process.env.DOOC_GITHUB_CLIENT_SECRET = "secret";
    const { default: viewer } = await import(new URL("../src/viewer.js?github", import.meta.url).href);
    assert.deepEqual(viewer.plugins.map((plugin: { id: string }) => plugin.id), ["github"]);
    delete process.env.DOOC_GITHUB_CLIENT_ID; delete process.env.DOOC_GITHUB_CLIENT_SECRET;
    process.env.DOOC_SLACK_CLIENT_ID = "slack-client";
    const slackViewer = (await import(new URL("../src/viewer.js?slack", import.meta.url).href)).default;
    assert.deepEqual(slackViewer.plugins.map((plugin: { id: string }) => plugin.id), ["slack"]);
    assert.equal(slackViewer.plugins[0].oauth.clientSecret, undefined);
  } finally {
    delete process.env.DOOC_GITHUB_CLIENT_ID; delete process.env.DOOC_GITHUB_CLIENT_SECRET;
    delete process.env.DOOC_SLACK_CLIENT_ID;
    Object.assign(process.env, previous);
  }
});
