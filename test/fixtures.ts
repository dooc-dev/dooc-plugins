import type { PluginContext } from "@sasaki-s-sci/dooc-plugin";
import { object, string, type Row } from "../src/common.js";
import assert from "node:assert/strict";

export const options = { clientId: "test-client", clientSecret: "test-secret" };
export const users = {
  github: { id: "github:7", name: "Ada" },
  linear: { id: "linear:org-id:acme:user-id", name: "Ada" },
  slack: { id: "slack:T123:acme.slack.com:U123", name: "Ada" },
};

export function context(service: keyof typeof users, handler: (url: URL, init: { method?: "GET" | "POST"; body: { query: string; variables: Row } }) => unknown) {
  const calls: { url: URL; init: { method?: "GET" | "POST"; body: { query: string; variables: Row } } }[] = [];
  return {
    calls, user: users[service],
    async request(source: string, input?: Parameters<PluginContext["request"]>[1]) {
      const body = input?.body ? object(input.body) : {};
      const init = { ...input, body: { ...body, query: typeof body.query === "string" ? body.query : "", variables: body.variables ? object(body.variables) : {} } };
      const url = new URL(source);
      assert.equal(url.origin, { github: "https://api.github.com", linear: "https://api.linear.app", slack: "https://slack.com" }[service]);
      assert.equal(url.username, ""); assert.equal(url.hash, "");
      assert(!source.includes(options.clientSecret));
      if (init?.method === "POST") {
        if (service === "slack") assert(["/api/auth.test", "/api/bookmarks.list"].includes(url.pathname));
        else assert.match(init.body.query, /^query\s/);
      }
      else assert.equal(init?.method ?? "GET", "GET");
      calls.push({ url, init });
      return handler(url, init);
    },
  };
}

export const page = <T>(nodes: T[] = [], cursor?: string) => ({ nodes, pageInfo: { hasNextPage: Boolean(cursor), endCursor: cursor ?? null } });
export const resource = {
  id: "00000000-0000-0000-0000-000000000001", title: "Improve previews", name: "Preview project", identifier: "DOC-42",
  number: 42, body: "Readable **body**", description: "Preview description", content: "Document content",
  state: { name: "In progress", type: "started" }, priorityLabel: "High", progress: 0.5,
};

export function linearContext(override?: (query: string, variables: Row) => unknown) {
  return context("linear", (url, init) => {
    assert.equal(url.pathname, "/graphql");
    const { query, variables } = init.body;
    if (override) { const result = override(query, variables); if (result !== undefined) return result; }
    if (query.startsWith("query Identity")) return { data: { viewer: { id: "user-id", name: "Ada", app: false, active: true, organization: { id: "org-id", urlKey: "acme" } } } };
    if (query.startsWith("query Related")) return { data: { resource: { collection: page([{ id: "child", title: "Related item", body: "Comment text" }]) } } };
    if (query.startsWith("query Resource")) return { data: { resource: query.includes("nodes {") ? { nodes: [resource] } : resource } };
    assert.fail(`Unexpected Linear query: ${query}`);
  });
}

export function slackContext(override?: (method: string, params: URLSearchParams) => unknown) {
  const primary = { ts: "1700000000.123456", text: "Launch <script>alert(1)</script>", user: "U123", reply_count: 1, reactions: [{ name: "tada", count: 2 }], files: [{ id: "F123", title: "Release notes" }] };
  return context("slack", (url, init) => {
    const method = url.pathname.slice(5), params = init?.method === "POST" ? new URLSearchParams(Object.entries(init.body).map(([key, value]) => [key, String(value)])) : url.searchParams;
    if (override) { const result = override(method, params); if (result !== undefined) return result; }
    switch (method) {
      case "auth.test": return { ok: true, user_id: "U123", team_id: "T123", url: "https://acme.slack.com/" };
      case "users.info": return { ok: true, user: { id: "U123", name: "ada", real_name: "Ada", is_bot: false, is_app_user: false, profile: { display_name: "Ada", title: "Engineer" } } };
      case "conversations.info": return { ok: true, channel: { id: "C123", name: "release", topic: { value: "Ship it" }, purpose: { value: "Release planning" }, num_members: 3 } };
      case "conversations.replies": return { ok: true, messages: [primary, { ts: "1700000001.000001", thread_ts: primary.ts, user: "U124", text: "Ready" }], has_more: false };
      case "conversations.history": return { ok: true, messages: [primary], has_more: false };
      case "conversations.members": return { ok: true, members: ["U123", "U124"], response_metadata: { next_cursor: "" } };
      case "conversations.list": return { ok: true, channels: [{ id: "C123", name: "release" }], response_metadata: { next_cursor: "" } };
      case "pins.list": return { ok: true, items: [{ message: primary }] };
      case "bookmarks.list": return { ok: true, bookmarks: [{ title: "Docs", link: "https://example.com" }] };
      case "reactions.get": return { ok: true, message: primary };
      case "files.info": return { ok: true, file: { id: "F123", title: "Release notes", mimetype: "text/plain", preview: "Release ready" } };
      case "team.info": return { ok: true, team: { id: "T123", name: "Acme" } };
      case "search.all": return { ok: true, messages: { matches: [primary], paging: { pages: 1 } }, files: { matches: [{ id: "F123", title: "Release notes" }], paging: { pages: 1 } } };
      default: assert.fail(`Unexpected Slack method: ${method}`);
    }
  });
}

export function githubContext(override?: (url: URL, init: { method?: "GET" | "POST"; body: { query: string; variables: Row } }) => unknown) {
  return context("github", (url, init) => {
    const path = url.pathname;
    if (override) { const result = override(url, init); if (result !== undefined) return result; }
    if (path === "/user") return { id: 7, login: "ada", name: "Ada", type: "User" };
    if (path === "/users/ada") return { id: 7, login: "ada", name: "Ada", bio: "Engineer" };
    if (path === "/repos/acme/docs") return { id: 1, full_name: "acme/docs", description: "Useful docs", stargazers_count: 12, language: "TypeScript" };
    if (path.endsWith("/readme")) return { name: "README.md", encoding: "base64", content: Buffer.from("# Documentation").toString("base64") };
    if (/\/(issues|pulls)\/42$/.test(path)) return { id: 1, title: "Improve previews", body: "Readable **body**", state: "open", user: { login: "ada" }, head: { sha: "abcdef1234" }, base: { ref: "main" } };
    if (/\/commits\/abcdef1234$/.test(path)) return { sha: "abcdef1234", commit: { message: "Improve previews" }, files: [{ filename: "src/index.ts", patch: "+new\n-old" }] };
    if (path.includes("/compare/")) return { status: "ahead", files: [{ filename: "src/index.ts", patch: "+new\n-old" }], commits: [{ sha: "abcdef1234", commit: { message: "Improve previews" } }] };
    if (path.endsWith("/contents")) return [{ name: "src", type: "dir" }];
    if (path.includes("/contents/")) return { name: "index.ts", encoding: "base64", content: Buffer.from("export const value = 42;").toString("base64") };
    if (/\/releases\/(tags\/.*|latest)$/.test(path)) return { name: "v1.0", tag_name: "v1.0", body: "Release notes", assets: [{ name: "archive.zip", size: 100 }] };
    if (/\/actions\/runs\/12$/.test(path)) return { id: 12, name: "Build", status: "completed", conclusion: "success" };
    if (/\/actions\/jobs\/34$/.test(path)) return { id: 34, name: "Test", steps: [{ name: "Test", conclusion: "success" }] };
    if (path.endsWith("/milestones/3")) return { id: 3, title: "Launch", description: "Ship it", open_issues: 2, closed_issues: 3 };
    if (path.endsWith("/actions/workflows/ci.yml")) return { id: 5, name: "CI", path: ".github/workflows/ci.yml" };
    if (path.endsWith("/actions/workflows/ci.yml/runs")) return { workflow_runs: [{ name: "CI run" }] };
    if (/\/gists\/abcdef(?:\/abcd)?$/.test(path)) return { description: "Example gist", files: { "hello.ts": { filename: "hello.ts", content: "console.log('hello');" } } };
    if (path === "/graphql") {
      if (init.body.query.startsWith("query Project(")) return { data: { owner: { projectV2: { id: "P1", title: "Roadmap", readme: "Next release", fields: page([]), views: page([]) } } } };
      if (init.body.query.startsWith("query ProjectItems")) return { data: { node: { items: page([{ id: "I1", content: { title: "Ship release", number: 42 }, fieldValues: page([{ name: "Done" }]) }]) } } };
      if (init.body.query.startsWith("query Discussion")) return { data: { repository: { discussion: { id: "D1", title: "Discussion", body: "Let's discuss", isAnswered: true } } } };
      return { data: { repository: { discussion: { comments: page([{ body: "A useful reply", replies: { nodes: [], pageInfo: { hasNextPage: false } } }]) } } } };
    }
    if (path.endsWith("/check-runs")) return { check_runs: [{ name: "Tests", conclusion: "success" }] };
    if (path.endsWith("/status")) return { state: "success", statuses: [] };
    if (path.endsWith("/jobs")) return { jobs: [{ name: "Tests" }] };
    if (path.endsWith("/artifacts")) return { artifacts: [{ name: "dist" }] };
    if (path.endsWith("/actions/runs")) return { workflow_runs: [{ name: "Build" }] };
    if (path === "/search/issues") return { items: [{ title: "Found issue" }] };
    if (/\/(comments|reactions|timeline|reviews|files|commits|releases|branches|tags|contributors|issues|pulls|repos|milestones)$/.test(path)) return [{ title: "Related item", body: "Useful detail" }];
    assert.fail(`Unexpected GitHub endpoint: ${url}`);
  });
}
