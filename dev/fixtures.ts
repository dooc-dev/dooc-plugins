import type { ActionContext } from "../src/actions.js";
import { object, string, type Row } from "../src/common.js";
import { PluginError } from "@dooc-dev/dooc-plugin";
// Fictional, deterministic data. No fixture falls back to a live service.
const page = <T>(nodes: T[] = []) => ({ nodes, pageInfo: { hasNextPage: false, endCursor: null } });
const ada = { id: "user-id", name: "Ada Mori", displayName: "Ada", login: "ada-mori" };
const ben = { id: "ben-id", name: "Ben Park", displayName: "Ben", login: "ben-park" };
const mina = { id: "mina-id", name: "Mina Ito", displayName: "Mina", login: "mina-ito" };
const updated = "2026-11-08T09:30:00Z";
const project = { id: "00000000-0000-0000-0000-000000000002", name: "Knowledge Hub", description: "ドキュメントと日々の開発をつなぐ、チームの情報ハブ。",
  content: "必要な情報をドキュメントから離れずに確認できるようにします。\n\n**11月のリリース目標**\n- [x] Linear の課題と担当・期限を表示\n- [x] GitHub のレビュー・CI 結果を表示\n- [ ] Slack のスレッド表示をモバイルで確認",
  status: { id: "project-started", name: "In progress" }, progress: 0.75, targetDate: "2026-11-15", lead: ada, updatedAt: updated };
const issue = { id: "00000000-0000-0000-0000-000000000001", identifier: "DOC-42", title: "サービスの URL を、状況が分かるプレビューカードにする",
  description: "Linear・GitHub・Slack のリンクから、作業の状態と次のアクションを確認できるようにします。\n\n**受け入れ条件**\n- [x] 担当者・期限・レビュー結果を表示\n- [x] コメントとスレッドをその場で読める\n- [ ] モバイル表示の最終確認",
  state: { name: "In progress", type: "started" }, priorityLabel: "High", assignee: ada, creator: ben,
  dueDate: "2026-11-12", estimate: 3, project: { id: project.id, name: project.name }, team: { key: "DOC", name: "Product Engineering" },
  createdAt: "2026-11-06T03:00:00Z", updatedAt: updated };
const issues = [
  { ...issue, id: "child-1", identifier: "DOC-43", title: "カードの状態・担当者・期限を表示", state: { name: "Done" }, assignee: ada, description: undefined },
  { ...issue, id: "child-2", identifier: "DOC-44", title: "PR のレビュー結果と差分を確認", state: { name: "Done" }, assignee: ben, description: undefined },
  { ...issue, id: "child-3", identifier: "DOC-45", title: "モバイルでスレッド表示を確認", state: { name: "In review" }, assignee: mina, description: undefined },
];
const comments = [
  { id: "comment-1", body: "カードの担当・期限・ステータスを確認しました。残りはモバイル表示の確認だけです。", user: ben, createdAt: "2026-11-08T08:50:00Z" },
  { id: "comment-2", body: "390px 幅でスレッドと差分を確認しています。今日中に結果を共有します。", user: mina, createdAt: updated },
];
const labels = [{ id: "label-enhancement", name: "Enhancement", color: "#655be8" }, { id: "label-viewer", name: "Viewer", color: "#3b82f6" }];
const cycle = { id: "00000000-0000-0000-0000-000000000003", number: 42, name: "Cycle 42 · November delivery", description: "プレビューカードをリリースし、チームの確認作業を短くする。",
  startsAt: "2026-11-02T00:00:00Z", endsAt: "2026-11-15T00:00:00Z", progress: 0.67, isActive: true, team: issue.team, updatedAt: updated };

export const linearFixture = (): Omit<ActionContext, "user"> => {
  const projectState = structuredClone(project), cycleState = structuredClone(cycle), updates: Row[] = [];
  const current = { ...structuredClone(issue), priority: 2, labels: page(labels), cycle: cycleState, branchName: "ada/doc-42-preview-cards", team: { id: "team-id", ...issue.team, members: page([ada, ben, mina]), labels: page(labels), projects: page([projectState]), cycles: page([cycleState]), states: page<{ id: string; name: string }>() } };
  const discussion = comments.map(comment => ({ ...structuredClone(comment), updatedAt: comment.createdAt }));
  const states = [{ id: "todo", name: "Todo", type: "unstarted" }, { id: "started", name: "In progress", type: "started" }, { id: "done", name: "Done", type: "completed" }];
  current.state = states[1]; current.team.states = page(states);
  let deleted = false, counter = 100;
  return { async request(source, init) {
  if (new URL(source).href !== "https://api.linear.app/graphql") throw new Error("Unknown demo endpoint");
  const body = object(init?.body), query = string(body.query), variables = object(body.variables ?? {});
  if (query.startsWith("query Identity")) return { data: { viewer: { ...ada, app: false, active: true, organization: { id: "org-id", urlKey: "acme" } } } };
  if (deleted && !query.includes("projects(") && !query.includes("cycles(")) throw new PluginError(404, "Issue deleted");
  if (query.startsWith("query ProjectOptions")) return { data: { projectStatuses: page([{ id: "project-started", name: "In progress" }, { id: "project-done", name: "Completed" }]), users: page([ada, ben, mina]) } };
  if (query.startsWith("query ActionIssue")) {
    if (![current.id, current.identifier].includes(string(variables.id))) throw new PluginError(404, "Unknown issue");
    return { data: { issue: { ...current, comments: page(discussion) } } };
  }
  if (query.startsWith("mutation")) {
    const input = variables.input ? object(variables.input) : {}, now = new Date(Date.parse(updated) + ++counter * 1000).toISOString();
    if (query.includes("commentCreate(")) {
      if (input.issueId !== current.id) throw new PluginError(404, "Unknown issue");
      discussion.push({ id: `comment-${counter}`, body: string(input.body), user: ada, createdAt: now, updatedAt: now });
    } else if (query.includes("commentUpdate(") || query.includes("commentDelete(")) {
      const index = discussion.findIndex(item => item.id === variables.id && item.user.id === ada.id);
      if (index < 0) throw new PluginError(403, "Not your comment");
      if (query.includes("commentDelete(")) discussion.splice(index, 1);
      else Object.assign(discussion[index], { body: input.body, updatedAt: now });
    } else if (variables.id === current.id && query.includes("issueUpdate(")) {
      const state = "stateId" in input ? states.find(state => state.id === input.stateId) : current.state;
      if (!state) throw new PluginError(400, "Unknown state");
      Object.assign(current, { ...("title" in input ? { title: input.title } : {}), ...("description" in input ? { description: input.description } : {}), state, updatedAt: now });
      for (const key of ["dueDate", "estimate", "priority"]) if (key in input) Object.assign(current, { [key]: input[key] });
      if ("priority" in input) current.priorityLabel = ["—", "Urgent", "High", "Medium", "Low"][Number(input.priority)];
      if ("assigneeId" in input) Object.assign(current, { assignee: [ada, ben, mina].find(item => item.id === input.assigneeId) ?? null });
      if ("projectId" in input) Object.assign(current, { project: input.projectId ? projectState : null });
      if ("cycleId" in input) Object.assign(current, { cycle: input.cycleId ? cycleState : null });
      if ("labelIds" in input) current.labels = page(labels.filter(item => (input.labelIds as string[]).includes(item.id)));
    } else if (variables.id === projectState.id && query.includes("projectUpdate(")) Object.assign(projectState, input, { updatedAt: now }, "leadId" in input ? { lead: [ada, ben, mina].find(v => v.id === input.leadId) ?? null } : {}, "statusId" in input ? { status: { id: input.statusId, name: input.statusId === "project-done" ? "Completed" : "In progress" } } : {});
    else if (variables.id === cycleState.id && query.includes("cycleUpdate(")) Object.assign(cycleState, input, { updatedAt: now });
    else if (query.includes("projectUpdateCreate(")) { if (input.projectId !== projectState.id) throw new PluginError(404, "Unknown project"); updates.push({ id: `update-${counter}`, ...input, user: ada, createdAt: now }); }
    else if (variables.id === current.id && query.includes("issueDelete(")) deleted = true;
    else throw new PluginError(400, "Unknown mutation");
    return { data: { result: { success: true } } };
  }
  if (query.startsWith("query Resource")) {
    const data = /resource: projects?\(/.test(query) ? projectState : /resource: cycles?\(/.test(query) ? cycleState : current;
    return { data: { resource: query.includes("nodes {") ? { nodes: [data] } : data } };
  }
  if (query.startsWith("query Related")) {
    const field = /collection: (\w+)/.exec(query)?.[1];
    const collections: Record<string, unknown[]> = {
      comments: discussion, children: issues, issues, labels: current.labels.nodes,
      attachments: [{ id: "attachment-1", title: "PR #42 · Preview cards", subtitle: "acme/docs · GitHub", sourceType: "github", url: "https://github.com/acme/docs/pull/42" }],
      relations: [], inverseRelations: [],
      history: [{ id: "event-1", actor: ada, fromState: { name: "Todo" }, toState: { name: "In progress" }, createdAt: "2026-11-07T02:00:00Z" }],
      documents: [{ id: "document-1", title: "プレビューカードの受け入れチェックリスト", updatedAt: updated }],
      projectUpdates: [...updates, { id: "update-1", body: "3サービスのカードが揃いました。11月12日までに QA を完了する予定です。", health: "onTrack", user: ada, createdAt: updated }],
      projectMilestones: [{ id: "milestone-1", name: "Internal preview", progress: 1, status: "Done", targetDate: "2026-11-08" }, { id: "milestone-2", name: "Team rollout", progress: 0.5, status: "In progress", targetDate: "2026-11-15" }],
      members: [ada, ben, mina], teams: [issue.team], externalLinks: [{ label: "リリース計画", url: "https://example.com/release-plan" }], uncompletedIssuesUponClose: [],
    };
    if (!field || !(field in collections)) throw new Error(`Unknown demo collection: ${field}`);
    return { data: { resource: { collection: page(collections[field]) } } };
  }
  throw new Error("Unknown demo query");
} }; };

const changedFiles = [
  { filename: "src/cards.ts", status: "added", additions: 86, deletions: 0, patch: "@@ -0,0 +1,4 @@\n+export function renderCard(item) {\n+  return card({ title: item.title, status: item.state,\n+    assignee: item.assignee, dueDate: item.dueDate });\n+}" },
  { filename: "src/slack.ts", status: "modified", additions: 18, deletions: 4, patch: "@@ -24,2 +24,3 @@\n-const author = message.user;\n+const author = users.get(message.user);\n+const replies = thread.filter(reply => reply.ts !== message.ts);\n return renderMessage({ ...message, author });" },
  { filename: "test/cards.test.ts", status: "added", additions: 32, deletions: 0, patch: "+test('cards escape provider HTML', () => {\n+  assert(!renderCard(fixture).includes('<script>'));\n+});" },
];
const checks = [{ name: "Typecheck", status: "completed", conclusion: "success" }, { name: "Unit tests · Node 22", status: "completed", conclusion: "success" }, { name: "Browser smoke", status: "in_progress", conclusion: null }];
export const githubFixture = (): Omit<ActionContext, "user"> => {
  const current = {
    id: 42, number: 42, title: "feat: 状況が伝わるサービスプレビューカード", state: "open", draft: false, node_id: "PR42", merged: false, mergeable: true, mergeable_state: "clean", user: { ...ada, id: 7 }, assignees: [{ ...ada, id: 7 }], milestone: null as Row | null, requested_reviewers: [{ ...ben, id: 8 }],
    body: "Linear・GitHub・Slack のリンクを、ドキュメント内で読めるカードにします。\n\n**今回の変更**\n- 担当者・期限・進捗の表示\n- レビューと CI の結果を要約\n- Slack の返信とリアクションを表示\n\nCloses **DOC-42** · モバイルのブラウザ確認を実行中です。",
    head: { sha: "abcdef1234", ref: "feat/preview-cards" }, base: { ref: "main" }, labels,
    additions: 136, deletions: 4, changed_files: 3, created_at: "2026-11-07T09:00:00Z", updated_at: updated,
  };
  const discussion = [{ id: 2, user: { ...mina, id: 9 }, body: "モバイル確認を進めています。CI が完了したら最終結果を共有します。", created_at: "2026-11-08T09:20:00Z" }];
  const reviews = [{ id: 1, user: { ...ben, id: 8 }, state: "APPROVED", body: "ステータスと差分が読みやすくなりました。変更内容は問題ありません。", submitted_at: "2026-11-08T08:45:00Z" }];
  const reviewComments: Row[] = [{ id: 3, user: { ...ben, id: 8 }, path: "src/cards.ts", body: "期限が未設定のカードでも崩れないことを確認しました。", created_at: "2026-11-08T08:40:00Z" }];
  const reactions: Row[] = [{ id: 1, content: "+1", user: { ...ben, id: 8 } }, { id: 2, content: "+1", user: { ...mina, id: 9 } }, { id: 3, content: "rocket", user: { ...ada, id: 7 } }];
  const repository = { full_name: "acme/docs", default_branch: "main", permissions: { push: true }, allow_merge_commit: true, allow_squash_merge: true, allow_rebase_merge: true };
  const run = { id: 12, name: "CI", display_title: "CI · Preview cards #42", status: "in_progress", conclusion: null as string | null, head_branch: "feat/preview-cards", head_sha: "abcdef1234", event: "pull_request", run_attempt: 1 };
  const sourceFile = { name: "index.ts", path: "src/index.ts", type: "file", sha: "file-sha-1", size: 42, encoding: "base64", content: Buffer.from('export const plugins = [];\n').toString("base64") };
  const projectState = { id: "P1", title: "Knowledge Hub · November", readme: "11月のプレビューカード改善。担当と状態を確認し、残りの QA を進めます。", viewerCanUpdate: true, closed: false, public: false, updatedAt: updated, fields: page([{ id: "status-field", name: "Status", dataType: "SINGLE_SELECT", options: [{ id: "todo", name: "Todo" }, { id: "done", name: "Done" }] }]), views: page([{ name: "Delivery", layout: "BOARD_LAYOUT" }]) };
  const projectRows: Row[] = issues.map((value, index) => ({ id: `I${index}`, content: { title: value.title, number: 43 + index, url: `https://github.com/acme/docs/issues/${43 + index}`, issueState: index < 2 ? "CLOSED" : "OPEN" }, fieldValues: page([{ name: index < 2 ? "Done" : "Todo", optionId: index < 2 ? "done" : "todo", field: { id: "status-field", name: "Status" } }]) }));
  let counter = 100;
  return { async request(source, init) {
  const url = new URL(source), path = url.pathname, method = init?.method ?? "GET";
  if (url.origin !== "https://api.github.com") throw new Error("Unknown demo origin");
  if (path === "/user") return { id: 7, login: ada.login, name: ada.name, type: "User" };
  if (path === "/repos/acme/docs") return repository;
  if (path.endsWith("/assignees")) return [{ ...ada, id: 7 }, { ...ben, id: 8 }, { ...mina, id: 9 }];
  if (path.endsWith("/labels")) return labels;
  if (path.endsWith("/milestones")) return [{ number: 1, title: "November" }];
  if (path.endsWith("/branches")) return [{ name: "main" }, { name: "feat/preview-cards" }];
  if (path !== "/graphql" && !path.startsWith("/repos/acme/docs/") && !path.startsWith("/repos/acme/docs?")) throw new PluginError(404, "Unknown repository");
  if (method !== "GET" && path !== "/graphql") {
    const input = init?.body ? object(init.body) : {}, now = new Date(Date.parse(updated) + ++counter * 1000).toISOString();
    if (/\/actions\/runs\/12\/(cancel|rerun|rerun-failed-jobs)$/.test(path)) { if (path.endsWith("cancel")) Object.assign(run, { status: "completed", conclusion: "cancelled" }); else Object.assign(run, { status: "queued", conclusion: null, run_attempt: run.run_attempt + 1 }); return null; }
    if (path.endsWith("/pulls/42/merge") && method === "PUT") { if (input.sha !== current.head.sha || current.state !== "open") throw new PluginError(409, "Changed head"); Object.assign(current, { merged: true, state: "closed", updated_at: now }); return { merged: true }; }
    if (path.endsWith("/requested_reviewers")) { current.requested_reviewers = method === "DELETE" ? current.requested_reviewers.filter(v => !(input.reviewers as string[]).includes(v.login)) : [ben, mina].filter(v => (input.reviewers as string[]).includes(v.login)).map(v => ({ ...v, id: v.id === ben.id ? 8 : 9 })); return current; }
    if (path.endsWith("/contents/src/index.ts")) { if (input.sha !== sourceFile.sha || input.branch !== "main") throw new PluginError(409, "Changed file"); if (method === "DELETE") { sourceFile.type = "deleted"; return null; } return Object.assign(sourceFile, { content: input.content, sha: `file-sha-${counter}` }); }
    if (path.endsWith("/issues/42/reactions") && method === "POST") { const reaction = reactions.find(v => v.content === input.content && object(v.user).id === 7) ?? { id: ++counter, content: input.content, user: { ...ada, id: 7 } }; if (!reactions.includes(reaction)) reactions.push(reaction); return reaction; }
    const reactionId = /\/issues\/42\/reactions\/(\d+)$/.exec(path)?.[1];
    if (reactionId && method === "DELETE") { const index = reactions.findIndex(v => v.id === Number(reactionId) && object(v.user).id === 7); if (index < 0) throw new PluginError(403, "Not your reaction"); reactions.splice(index, 1); return null; }
    const replyId = /\/pulls\/42\/comments\/(\d+)\/replies$/.exec(path)?.[1];
    if (replyId && method === "POST") { const parent = reviewComments.find(v => v.id === Number(replyId) && !v.in_reply_to_id); if (!parent) throw new PluginError(404, "Unknown comment"); const reply = { id: ++counter, in_reply_to_id: parent.id, path: parent.path, body: input.body, user: { ...ada, id: 7 }, created_at: now }; reviewComments.push(reply); return reply; }
    const reviewId = /\/pulls\/42\/reviews\/(\d+)$/.exec(path)?.[1], lineId = /\/pulls\/comments\/(\d+)$/.exec(path)?.[1];
    if (reviewId || lineId) { const items: Row[] = reviewId ? reviews : reviewComments; const index = items.findIndex(v => v.id === Number(reviewId ?? lineId) && object(v.user).id === 7); if (index < 0) throw new PluginError(403, "Not your review"); if (method === "DELETE") { items.splice(index, 1); return null; } return Object.assign(items[index], { body: input.body, updated_at: now }); }
    if (method === "POST" && path === "/repos/acme/docs/issues/42/comments") {
      const comment = { id: counter, body: string(input.body), user: { ...ada, id: 7 }, created_at: now, updated_at: now };
      discussion.push(comment); return comment;
    }
    if (method === "POST" && path === "/repos/acme/docs/pulls/42/reviews") {
      const review = { id: counter, body: string(input.body), state: { COMMENT: "COMMENTED", APPROVE: "APPROVED", REQUEST_CHANGES: "CHANGES_REQUESTED" }[string(input.event) as "COMMENT" | "APPROVE" | "REQUEST_CHANGES"], user: { ...ada, id: 7 }, submitted_at: now };
      reviews.push(review); return review;
    }
    if (method === "PATCH" && /\/(issues|pulls)\/42$/.test(path)) {
      const fields = { ...input };
      if ("labels" in input) fields.labels = labels.filter(v => (input.labels as string[]).includes(v.name));
      if ("assignees" in input) fields.assignees = [ada, ben, mina].filter(v => (input.assignees as string[]).includes(v.login));
      if ("milestone" in input) fields.milestone = input.milestone ? { number: 1, title: "November" } : null;
      return Object.assign(current, fields, { updated_at: now });
    }
    const match = /^\/repos\/acme\/docs\/issues\/comments\/(\d+)$/.exec(path);
    const index = discussion.findIndex(item => item.id === Number(match?.[1]) && item.user.id === 7);
    if (!match || index < 0) throw new PluginError(403, "Not your comment");
    if (method === "DELETE") { discussion.splice(index, 1); return null; }
    if (method === "PATCH") return Object.assign(discussion[index], { body: input.body, updated_at: now });
    throw new PluginError(400, "Unknown operation");
  }
  if (/\/(issues|pulls)\/42$/.test(path)) return current;
  if (path.endsWith("/pulls/42/files")) return changedFiles;
  if (path.endsWith("/pulls/42/reviews")) return reviews;
  if (path.endsWith("/issues/42/comments")) return discussion;
  if (path.endsWith("/pulls/42/comments")) return reviewComments;
  if (path.endsWith("/reactions")) return reactions;
  if (path.endsWith("/timeline")) return [{ event: "review_requested", actor: ada, created_at: "2026-11-07T09:10:00Z" }];
  if (path.endsWith("/commits")) return [{ sha: "abcdef1234", commit: { message: "feat: render useful service cards" }, author: ada }];
  if (path.endsWith("/check-runs")) return { check_runs: checks };
  if (path.endsWith("/status")) return { state: "pending", total_count: 1, statuses: [{ context: "Browser smoke", state: "pending", description: "Mobile viewport check is running" }] };
  if (path.endsWith("/contents/src/index.ts")) { if (sourceFile.type === "deleted") throw new PluginError(404, "Deleted file"); return sourceFile; }
  if (path.includes("/contents/")) throw new PluginError(404, "Unknown file or ref");
  if (path === "/graphql") {
    const request = object(init?.body), query = string(request.query), variables = object(request.variables ?? {}), input = object(variables.input ?? {});
    if (query.startsWith("query Project(") || query.startsWith("query ActionProject(")) return { data: { owner: { projectV2: projectState } } };
    if (query.startsWith("query ProjectItems")) return { data: { node: { items: page(projectRows) } } };
    if (query.startsWith("mutation Draft")) { current.draft = !current.draft; return { data: { result: { pullRequest: { id: current.node_id } } } }; }
    if (query.startsWith("mutation ProjectWrite")) {
      if (input.projectId !== projectState.id) throw new PluginError(403, "Foreign project");
      const item = projectRows.find(v => v.id === input.itemId);
      if (query.includes("updateProjectV2(input")) Object.assign(projectState, input, { updatedAt: String(++counter) });
      else if (query.includes("addProjectV2DraftIssue")) projectRows.push({ id: `I${++counter}`, content: { title: input.title, body: input.body }, fieldValues: page([]) });
      else if (!item) throw new PluginError(403, "Foreign item");
      else if (query.includes("deleteProjectV2Item")) projectRows.splice(projectRows.indexOf(item), 1);
      else if (query.includes("archiveProjectV2Item")) item.isArchived = !query.includes("unarchiveProjectV2Item");
      else { const value = object(input.value ?? {}); item.fieldValues = page(value.singleSelectOptionId ? [{ name: value.singleSelectOptionId === "done" ? "Done" : "Todo", optionId: value.singleSelectOptionId, field: { id: "status-field", name: "Status" } }] : []); }
      return { data: { result: { id: "ok" } } };
    }
  }
  if (path.endsWith("/actions/runs/12")) return run;
  if (path.endsWith("/jobs")) return { jobs: checks.map((check, index) => ({ id: index + 1, ...check })) };
  if (path.endsWith("/artifacts")) return { artifacts: [{ id: 1, name: "unit-test-results", size_in_bytes: 8420, expired: false }] };
  throw new Error(`Unknown demo endpoint: ${path}`);
} }; };

const stamp = (time: string) => `${Date.parse(time) / 1000}.000000`;
const root = stamp("2026-11-08T09:00:00Z");
const file = { id: "F123", title: "Preview cards · QA checklist", name: "notes.md", mimetype: "text/markdown", size: 2840, user: "U123", created: Date.parse("2026-11-08T09:00:00Z") / 1000,
  preview: "# Preview cards · QA checklist\n\n- [x] Linear: 状態・担当・期限を確認\n- [x] GitHub: レビュー・差分・CI を確認\n- [ ] Slack: モバイルで返信を確認\n\nRelease target: 2026-11-15" };
interface SlackMessage { ts: string; user: string; text: string; thread_ts?: string; reply_count?: number; reactions?: { name: string; count: number; users?: string[] }[]; files?: (typeof file)[]; edited?: { user: string; ts: string } }
const messages: SlackMessage[] = [
  { ts: root, user: "U123", text: "*プレビューカードの確認をお願いします*\n\n3サービスのカードを更新しました。DOC-42 / PR #42 で変更を確認できます。\n• Linear：担当・期限・ステータス\n• GitHub：レビュー・CI・ファイル差分\n• Slack：返信・リアクション\n\n*残りはモバイルの確認です。11/12 までに QA を完了しましょう。*", reply_count: 2,
    reactions: [{ name: "eyes", count: 3 }, { name: "+1", count: 2 }, { name: "rocket", count: 1 }], files: [file] },
  { ts: stamp("2026-11-08T09:10:00Z"), thread_ts: root, user: "U124", text: "PR のレビュー完了です。*Approved* にしました。差分と CI 結果もカードから確認できました。", reactions: [{ name: "white_check_mark", count: 2 }] },
  { ts: stamp("2026-11-08T09:25:00Z"), thread_ts: root, user: "U125", text: "390px 幅で確認中です。スレッドが横にはみ出さないかと、折りたたみの操作を見ています。" },
];
const channel = { id: "C123", name: "release", topic: { value: "Knowledge Hub · November release" }, purpose: { value: "11/15 リリースに向けて、レビュー・QA・リリース判定を共有するチャンネル。" }, num_members: 3, is_private: false, is_archived: false };
export const slackFixture = (): Omit<ActionContext, "user"> => {
  const thread = structuredClone(messages);
  for (const message of thread) for (const reaction of message.reactions ?? []) reaction.users = ["U124", "U125"];
  let counter = 0;
  return { async request(source, init) {
  const url = new URL(source), method = url.pathname.slice(5), params = init?.method === "POST" ? new URLSearchParams(Object.entries(object(init.body)).map(([key, value]) => [key, String(value)])) : url.searchParams;
  if (url.origin !== "https://slack.com") throw new Error("Unknown demo origin");
  if (params.has("channel") && params.get("channel") !== channel.id) return { ok: false, error: "channel_not_found" };
  if (["chat.postMessage", "chat.update", "chat.delete", "reactions.add", "reactions.remove"].includes(method)) {
    const ts = `${1794132000 + ++counter}.000000`, target = thread.find(item => item.ts === (params.get("ts") ?? params.get("timestamp")));
    if (method === "chat.postMessage") {
      const parent = params.get("thread_ts");
      if (parent && !thread.some(item => item.ts === parent)) return { ok: false, error: "thread_not_found" };
      const message = { ts, user: "U123", text: params.get("text") ?? "", ...(parent ? { thread_ts: parent } : {}) };
      thread.push(message); if (parent) { const root = thread.find(item => item.ts === parent)!; root.reply_count = (root.reply_count ?? 0) + 1; }
      return { ok: true, message };
    }
    if (!target) return { ok: false, error: "message_not_found" };
    if (method.startsWith("reactions.")) {
      const name = params.get("name") ?? ""; target.reactions ??= [];
      let reaction = target.reactions.find(item => item.name === name);
      if (method === "reactions.add") {
        if (reaction?.users?.includes("U123")) return { ok: false, error: "already_reacted" };
        if (!reaction) { reaction = { name, count: 0, users: [] }; target.reactions.push(reaction); }
        reaction.users!.push("U123"); reaction.count++;
      } else {
        if (!reaction?.users?.includes("U123")) return { ok: false, error: "no_reaction" };
        reaction.users = reaction.users!.filter(user => user !== "U123"); reaction.count--;
        if (!reaction.count) target.reactions.splice(target.reactions.indexOf(reaction), 1);
      }
    } else {
      if (target.user !== "U123") return { ok: false, error: "cant_update_message" };
      if (method === "chat.update") Object.assign(target, { text: params.get("text") ?? "", edited: { user: "U123", ts } });
      else {
        thread.splice(thread.indexOf(target), 1);
        const parent = thread.find(item => item.ts === target.thread_ts); if (parent) parent.reply_count = Math.max(0, (parent.reply_count ?? 0) - 1);
      }
    }
    return { ok: true };
  }
  switch (method) {
    case "auth.test": return { ok: true, user_id: "U123", team_id: "T123", url: "https://acme.slack.com/" };
    case "users.info": {
      const user = ({ U123: ada, U124: ben, U125: mina } as Record<string, typeof ada>)[params.get("user") ?? ""];
      if (!user) return { ok: false, error: "user_not_found" };
      return { ok: true, user: { id: params.get("user"), name: user.login, real_name: user.name, is_bot: false, is_app_user: false, profile: { display_name: user.name, title: "Product Engineer" } } };
    }
    case "conversations.info": return { ok: true, channel };
    case "conversations.replies": return { ok: true, messages: thread.filter(item => item.ts === params.get("ts") || item.thread_ts === params.get("ts")), has_more: false };
    case "conversations.history": return { ok: true, messages: thread.filter(item => params.has("latest") ? item.ts === params.get("latest") : !item.thread_ts), has_more: false };
    case "conversations.members": return { ok: true, members: ["U123", "U124", "U125"], response_metadata: { next_cursor: "" } };
    case "pins.list": return { ok: true, items: thread.filter(item => item.ts === root).map(message => ({ message })) };
    case "bookmarks.list": return { ok: true, bookmarks: [{ title: "QA checklist", link: "https://example.com/qa" }, { title: "Release plan", link: "https://example.com/release" }] };
    case "reactions.get": return { ok: true, message: thread.find(item => item.ts === params.get("timestamp")) };
    case "files.info": return { ok: true, file };
    default: throw new Error(`Unknown demo method: ${method}`);
  }
} }; };
