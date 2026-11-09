import { withActions, bodyField, titleField, version, type ActionContext, type ActionField, type ActionPlugin, type BoundAction } from "./actions.js";
import { PluginError, type PluginContext } from "@dooc-dev/dooc-plugin";
import { brandIcons } from "./brand-icons.js";
import { parseDocument } from "yaml";
import { array, connection, graphql, label, MAX_PAGES, MORE, object, optionalSections, PAGE_SIZE, partialPage, pathParts, segment, string, view, type OAuthOptions, type Row, type Section } from "./common.js";

const API = "https://api.github.com";
type Route = { kind: string; base: string; id?: string; tail?: string[]; owner?: string; repo?: string; ownerType?: string };
const name = /^[\w.-]+$/;
const number = /^\d+$/;

function parse(url: URL): Route | undefined {
  const p = pathParts(url);
  if (!p) return;
  if (url.hostname === "gist.github.com" && p.length >= 2 && p.length <= 3 && name.test(p[0]) && /^[a-f\d]+$/i.test(p[1]) && (!p[2] || /^[a-f\d]+$/i.test(p[2])))
    return { kind: "gist", base: `/gists/${segment(p[1])}`, id: p[2] };
  if (url.hostname !== "github.com" || !name.test(p[0])) return;
  if (["users", "orgs"].includes(p[0]) && name.test(p[1] ?? "") && p[2] === "projects" && number.test(p[3] ?? "") && (p.length === 4 || (p.length === 6 && p[4] === "views" && number.test(p[5]))))
    return { kind: "project", base: "", owner: p[1], id: p[3], ownerType: p[0] === "users" ? "user" : "organization" };
  if (p.length === 1 && !["login", "settings", "explore", "marketplace", "notifications", "search", "features", "topics", "collections", "pricing", "orgs", "organizations"].includes(p[0]))
    return { kind: "profile", base: `/users/${segment(p[0])}` };
  if (p.length < 2 || !name.test(p[1])) return;
  const owner = p[0], repo = p[1].replace(/\.git$/, "");
  if (!repo) return;
  const base = `/repos/${segment(owner)}/${segment(repo)}`, common = { base, owner, repo };
  if (p.length === 2) return { ...common, kind: "repository" };
  if (p.length === 3 && ["issues", "pulls", "releases", "tags", "branches", "commits", "milestones"].includes(p[2])) return { ...common, kind: p[2] };
  if (p[2] === "milestone" && p.length === 4 && number.test(p[3])) return { ...common, kind: "milestone", id: p[3] };
  if (["issues", "pull", "discussions"].includes(p[2]) && number.test(p[3] ?? "") && (p.length === 4 || (p[2] === "pull" && p.length === 5 && ["files", "commits", "checks"].includes(p[4]))))
    return { ...common, kind: p[2] === "issues" ? "issue" : p[2], id: p[3] };
  if (p[2] === "commit" && p.length === 4 && /^[a-f\d]{7,40}$/i.test(p[3])) return { ...common, kind: "commit", id: p[3] };
  if (p[2] === "compare" && p.length >= 4 && p.slice(3).join("/").includes("...")) return { ...common, kind: "compare", id: p.slice(3).join("/") };
  if (["blob", "tree"].includes(p[2]) && p.length >= (p[2] === "blob" ? 5 : 4) && p.length <= 24) return { ...common, kind: p[2], tail: p.slice(3) };
  if (p[2] === "releases" && p[3] === "tag" && p.length >= 5) return { ...common, kind: "release", id: p.slice(4).join("/") };
  if (p[2] === "releases" && p[3] === "latest" && p.length === 4) return { ...common, kind: "release" };
  if (p[2] === "actions" && p[3] === "runs" && number.test(p[4] ?? "")) {
    if (p.length === 5) return { ...common, kind: "run", id: p[4] };
    if (p.length === 7 && p[5] === "job" && number.test(p[6])) return { ...common, kind: "job", id: p[6] };
  }
  if (p[2] === "actions" && p.length === 3) return { ...common, kind: "runs" };
  if (p[2] === "actions" && p[3] === "workflows" && p.length === 5 && name.test(p[4])) return { ...common, kind: "workflow", id: p[4] };
}

async function list(context: PluginContext, path: string, key?: string): Promise<Section> {
  const data: unknown[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = new URL(API + path);
    url.searchParams.set("per_page", String(PAGE_SIZE));
    url.searchParams.set("page", String(page));
    let response: unknown;
    try { response = await context.request(url.href); }
    catch (error) { return partialPage(error, data, ""); }
    const items = array(key ? object(response)[key] : response);
    data.push(...items);
    if (items.length < PAGE_SIZE) return { title: "", data };
  }
  return { title: "", data, note: MORE };
}

async function extras(context: PluginContext, paths: Record<string, string | [string, string]>): Promise<Section[]> {
  const sections = await optionalSections(Object.fromEntries(Object.entries(paths).map(([title, value]) =>
    [title, () => list(context, typeof value === "string" ? value : value[0], typeof value === "string" ? undefined : value[1])])));
  return sections.map(section => section.data === null ? section : { ...object(section.data), title: section.title } as Section);
}

async function contents(context: PluginContext, route: Route): Promise<{ data: unknown; ref: string; path: string }> {
  const tail = route.tail!;
  // Git refs can contain slashes; try the longest ref before interpreting the remainder as a path.
  for (let split = tail.length - (route.kind === "blob" ? 1 : 0); split >= 1; split--) {
    const ref = tail.slice(0, split).join("/"), path = tail.slice(split).map(segment).join("/");
    try {
      const data = await context.request(`${API}${route.base}/contents${path ? `/${path}` : ""}?ref=${segment(ref)}`);
      if (route.kind === "blob" && Array.isArray(data)) continue;
      return { data, ref, path: tail.slice(split).join("/") };
    } catch (error) {
      // dooc currently maps upstream 404s to 502, so that status must also try the next split.
      if (!(error instanceof Error) || error.name !== "DoocPluginError" || ![404, 502].includes((error as PluginError).status)) throw error;
      if (split === 1) throw error;
    }
  }
  throw new PluginError(404, "GitHub file or ref not found");
}

function fileText(data: Row): string | undefined {
  if (data.encoding !== "base64" || typeof data.content !== "string") return;
  const bytes = Buffer.from(data.content, "base64");
  if (bytes.includes(0)) return;
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { return; }
}

async function projectItems(context: PluginContext, id: string): Promise<Section> {
  const items: unknown[] = []; let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    let result: Row;
    try {
      result = await graphql(context, `${API}/graphql`, `query ProjectItems($id: ID!, $after: String) {
        node(id: $id) { ... on ProjectV2 { items(first: 30, after: $after) {
          nodes { id type isArchived createdAt updatedAt
            content { ... on Issue { title number url issueState: state } ... on PullRequest { title number url pullRequestState: state } ... on DraftIssue { title body } }
            fieldValues(first: 30) { nodes {
              ... on ProjectV2ItemFieldTextValue { text field { ... on ProjectV2FieldCommon { id name } } }
              ... on ProjectV2ItemFieldNumberValue { number field { ... on ProjectV2FieldCommon { id name } } }
              ... on ProjectV2ItemFieldDateValue { date field { ... on ProjectV2FieldCommon { id name } } }
              ... on ProjectV2ItemFieldSingleSelectValue { name optionId field { ... on ProjectV2FieldCommon { id name } } }
              ... on ProjectV2ItemFieldIterationValue { title iterationId startDate duration field { ... on ProjectV2FieldCommon { id name } } }
            } pageInfo { hasNextPage } }
          } pageInfo { hasNextPage endCursor }
        } } }
      }`, { id, after: cursor });
    } catch (error) { return partialPage(error, items, "Items"); }
    const resultPage = connection(object(result.node).items);
    items.push(...resultPage.nodes.map(value => {
      const item = object(value);
      return { ...item, ...(item.content ? object(item.content) : { title: "Inaccessible or redacted item" }) };
    }));
    if (!resultPage.cursor) return { title: "Items", data: items };
    if (resultPage.cursor === cursor) throw new PluginError(502, "GitHub pagination did not advance");
    cursor = resultPage.cursor;
  }
  return { title: "Items", data: items, note: MORE };
}

async function githubProjectActions(route: Route, context: ActionContext): Promise<BoundAction[]> {
  const result = await graphql(context, `${API}/graphql`, `query ActionProject($owner: String!, $number: Int!) {
    owner: ${route.ownerType}(login: $owner) { projectV2(number: $number) { id title readme shortDescription closed updatedAt viewerCanUpdate
      fields(first: 30) { nodes { ... on ProjectV2FieldCommon { id name dataType } ... on ProjectV2SingleSelectField { options { id name } }
        ... on ProjectV2IterationField { configuration { iterations { id title } completedIterations { id title } } } } }
    } }
  }`, { owner: route.owner, number: Number(route.id) });
  const data = object(object(result.owner).projectV2);
  if (data.viewerCanUpdate !== true) return [];
  const projectId = string(data.id), target = string(data.title);
  const mutate = async (name: string, type: string, input: Row, selection: string) => {
    await graphql(context, `${API}/graphql`, `mutation ProjectWrite($input: ${type}!) { ${name}(input: $input) { ${selection} } }`, { input });
    return { message: "更新しました" };
  };
  const actions: BoundAction[] = [{ id: "resource.update", label: "Project を編集", target, partial: true, version: version(data.updatedAt, data.title, data.readme, data.closed), fields: [titleField(target), { ...bodyField(label(data.readme)), name: "readme", required: false }, { name: "closed", label: "状態", type: "select", value: String(data.closed), options: [{ value: "false", label: "Open" }, { value: "true", label: "Closed" }] }],
    run: values => mutate("updateProjectV2", "UpdateProjectV2Input", { projectId, ...values, ...("closed" in values ? { closed: values.closed === "true" } : {}) }, "projectV2 { id }") },
  { id: "draft.create", label: "Draft を追加", target, fields: [titleField(""), { ...bodyField(), required: false }], run: values => mutate("addProjectV2DraftIssue", "AddProjectV2DraftIssueInput", { projectId, ...values }, "projectItem { id }") }];
  const definitions = array(object(data.fields).nodes).map(object);
  for (const item of array((await projectItems(context, projectId)).data).map(object)) {
    const itemId = string(item.id), target = label(item.title) || "Item";
    const values = array(object(item.fieldValues).nodes).map(object);
    for (const field of definitions) {
      if (!["TEXT", "NUMBER", "DATE", "SINGLE_SELECT", "ITERATION"].includes(String(field.dataType))) continue;
      const fieldId = string(field.id), key = ({ TEXT: "text", NUMBER: "number", DATE: "date", SINGLE_SELECT: "singleSelectOptionId", ITERATION: "iterationId" } as Record<string, string>)[String(field.dataType)];
      const current = values.find(value => object(value.field).id === fieldId) ?? {};
      const options = field.options ?? (field.configuration ? [...array(object(field.configuration).iterations), ...array(object(field.configuration).completedIterations)] : undefined);
      const input: ActionField = { name: "value", label: string(field.name), type: options ? "select" : field.dataType === "NUMBER" ? "number" : field.dataType === "DATE" ? "date" : "text", value: String(current.optionId ?? current[key] ?? ""), ...(options ? { options: [{ value: "", label: "—" }, ...array(options).map(value => ({ value: string(object(value).id), label: label(object(value).name ?? object(value).title) }))] } : {}) };
      actions.push({ id: `item.field/${itemId}/${fieldId}`, label: `${target} · ${field.name}`, target, version: version(current), fields: [input], run: values => values.value === ""
        ? mutate("clearProjectV2ItemFieldValue", "ClearProjectV2ItemFieldValueInput", { projectId, itemId, fieldId }, "projectV2Item { id }")
        : mutate("updateProjectV2ItemFieldValue", "UpdateProjectV2ItemFieldValueInput", { projectId, itemId, fieldId, value: { [key]: key === "number" ? Number(values.value) : values.value } }, "projectV2Item { id }") });
    }
    actions.push({ id: `item.archive/${itemId}`, label: item.isArchived ? "復元" : "アーカイブ", target, version: version(item.isArchived), fields: [], run: () => mutate(item.isArchived ? "unarchiveProjectV2Item" : "archiveProjectV2Item", item.isArchived ? "UnarchiveProjectV2ItemInput" : "ArchiveProjectV2ItemInput", { projectId, itemId }, "item { id }") },
    { id: `item.delete/${itemId}`, label: "Project から除去", target, destructive: true, version: version(item), fields: [], run: () => mutate("deleteProjectV2Item", "DeleteProjectV2ItemInput", { projectId, itemId }, "deletedItemId") });
  }
  return actions;
}

async function githubActions(url: URL, context: ActionContext): Promise<BoundAction[]> {
  const route = parse(url);
  if (!route) return [];
  if (!/^github:\d+$/.test(context.user.id)) throw new PluginError(403, "Connect a GitHub user account");
  const { base, id, kind } = route;
  const write = async (path: string, method: "POST" | "PUT" | "PATCH" | "DELETE", body: Row | undefined, message = "更新しました") => {
    const result = await context.request(`${API}${base}${path}`, { method, ...(body ? { body } : {}) });
    if (path.endsWith("/merge") && object(result).merged !== true) throw new PluginError(409, "マージできませんでした");
    return { message };
  };
  if (kind === "project") return githubProjectActions(route, context);
  if (!["issue", "pull", "run", "job", "workflow", "blob", "release", "milestone", "repository", "issues", "milestones"].includes(kind)) return [];
  const repo = object(await context.request(`${API}${base}`)), canWrite = object(repo.permissions ?? {}).push === true;
  if (["run", "job", "workflow"].includes(kind)) {
    if (!canWrite) return [];
    const path = `/actions/${kind === "run" ? "runs" : kind === "job" ? "jobs" : "workflows"}/${segment(id!)}`;
    const data = object(await context.request(`${API}${base}${path}`)), target = label(data.display_title) || label(data.name);
    if (kind === "workflow") {
      const branches = array((await list(context, `${base}/branches`)).data).map(value => ({ value: string(object(value).name), label: string(object(value).name) }));
      const source = object(await context.request(`${API}${base}/contents/${string(data.path).split("/").map(segment).join("/")}?ref=${segment(string(repo.default_branch))}`));
      const yaml = parseDocument(fileText(source) ?? "", { uniqueKeys: true });
      if (yaml.errors.length) throw new PluginError(502, "Workflow を読み込めませんでした");
      const config = object(yaml.toJS({ maxAliasCount: 100 })), on = config.on;
      const dispatch = on === "workflow_dispatch" || Array.isArray(on) && on.includes("workflow_dispatch") || on && typeof on === "object" && Object.hasOwn(on, "workflow_dispatch");
      const definitions = on && !Array.isArray(on) && typeof on === "object" ? object(object(object(on).workflow_dispatch ?? {}).inputs ?? {}) : {};
      const fields: ActionField[] = [{ name: "ref", label: "Branch", type: "select", required: true, value: label(repo.default_branch), options: branches }];
      for (const [key, definition] of Object.entries(definitions)) {
        const field = object(definition), type = field.type;
        const values = type === "boolean" ? ["false", "true"] : type === "choice" ? array(field.options) : type === "environment" ? array((await list(context, `${base}/environments`, "environments")).data).map(value => object(value).name) : undefined;
        fields.push({ name: `input:${key}`, label: label(field.description) || key, type: values ? "select" : type === "number" ? "number" : "text", required: field.required === true, value: String(field.default ?? (type === "boolean" ? "false" : values?.[0] ?? "")), ...(values ? { options: values.map(value => ({ value: String(value), label: String(value) })) } : {}) });
      }
      return [...(dispatch && data.state === "active" ? [{ id: "workflow.dispatch", label: "実行", target, version: version(source.sha), fields,
        run: (values: Record<string, string>) => write(`${path}/dispatches`, "POST", { ref: values.ref, inputs: Object.fromEntries(Object.entries(values).filter(([key]) => key.startsWith("input:")).map(([key, value]) => [key.slice(6), value])) }, "実行しました") } satisfies BoundAction] : []),
      { id: "workflow.toggle", label: data.state === "active" ? "無効化" : "有効化", target, confirm: true, version: version(data.state), fields: [], run: () => write(`${path}/${data.state === "active" ? "disable" : "enable"}`, "PUT", {}) }];
    }
    const revision = version(data.status, data.conclusion, data.run_attempt, data.updated_at, data.head_sha);
    const action = (id: string, label: string, suffix: string, confirm = false): BoundAction => ({ id, label, target, version: revision, confirm, fields: [], run: () => write(`${path}/${suffix}`, "POST", {}, label) });
    return data.status === "completed" ? [action("run.rerun", "再実行", "rerun"), ...(kind === "run" && ["failure", "timed_out"].includes(String(data.conclusion)) ? [action("run.rerunFailed", "失敗した Job を再実行", "rerun-failed-jobs")] : [])]
      : kind === "run" ? [action("run.cancel", "停止", "cancel", true)] : [];
  }
  if (kind === "blob") {
    if (!canWrite) return [];
    const result = await contents(context, route), data = object(result.data), body = fileText(data);
    if (body === undefined || body.length > 4000 || !data.sha) return [];
    const branches = array((await list(context, `${base}/branches`)).data);
    if (!branches.some(value => object(value).name === result.ref)) return [];
    const path = `/contents/${result.path.split("/").map(segment).join("/")}`, target = `${result.ref}:${result.path}`;
    return [{ id: "file.update", label: "ファイルを編集", target, version: version(data.sha), fields: [{ ...bodyField(body), required: false }, { ...titleField(""), name: "message", label: "Commit message" }],
      run: values => write(path, "PUT", { message: values.message, content: Buffer.from(values.body).toString("base64"), sha: data.sha, branch: result.ref }) },
    { id: "file.delete", label: "ファイルを削除", target, destructive: true, version: version(data.sha), fields: [{ ...titleField(""), name: "message", label: "Commit message" }],
      run: async values => ({ ...await write(path, "DELETE", { message: values.message, sha: data.sha, branch: result.ref }, "削除しました"), deleted: true }) }];
  }
  if (["repository", "issues", "milestones"].includes(kind)) {
    if (kind === "milestones" && !canWrite) return [];
    return [{ id: kind === "milestones" ? "milestone.create" : "issue.create", label: kind === "milestones" ? "Milestone を作成" : "Issue を作成", target: `${route.owner}/${route.repo}`, fields: [titleField(""), { ...bodyField(), required: false }],
      run: values => write(kind === "milestones" ? "/milestones" : "/issues", "POST", { title: values.title, [kind === "milestones" ? "description" : "body"]: values.body }, "作成しました") }];
  }
  if (kind === "release" || kind === "milestone") {
    if (!canWrite) return [];
    const data = object(await context.request(`${API}${base}/${kind === "release" ? `releases/${id ? `tags/${segment(id)}` : "latest"}` : `milestones/${id}`}`));
    const path = `/${kind === "release" ? "releases" : "milestones"}/${kind === "release" ? data.id : id}`, target = label(data.name) || label(data.title) || label(data.tag_name);
    const fields: ActionField[] = [{ ...titleField(target), name: kind === "release" ? "name" : "title" }, { ...bodyField(label(data.body ?? data.description)), name: kind === "release" ? "body" : "description", required: false }];
    if (kind === "milestone") fields.push({ name: "state", label: "状態", type: "select", value: label(data.state), options: ["open", "closed"].map(value => ({ value, label: value })) });
    return [{ id: "resource.update", label: "編集", target, version: version(data), partial: true, fields, run: values => write(path, "PATCH", values) }, { id: "resource.delete", label: "削除", target, version: version(data), destructive: true, fields: [], run: async () => ({ ...await write(path, "DELETE", undefined, "削除しました"), deleted: true }) }];
  }
  const endpoint = `${API}${base}/${kind === "pull" ? "pulls" : "issues"}/${id}`;
  const data = object(await context.request(endpoint));
  const target = `${route.owner}/${route.repo} #${id} · ${data.title}`;
  const actions: BoundAction[] = [{
    id: "comment.create", label: "コメントを投稿", target, fields: [bodyField()],
    run: values => write(`/issues/${id}/comments`, "POST", { body: values.body }, "コメントを投稿しました"),
  }];
  if (canWrite || String(object(data.user).id) === context.user.id.slice(7)) actions.push({
    id: "resource.update", label: kind === "pull" ? "PR を編集 / Close・Reopen" : "Issue を編集 / Close・Reopen", target, partial: true,
    version: version(data.updated_at, data.title, data.body, data.state),
    fields: [titleField(string(data.title)), { ...bodyField(label(data.body)), label: "説明", required: false }, {
      name: "state", label: "状態", type: "select", required: true, value: string(data.state),
      options: [{ value: "open", label: data.draft ? "Draft (open)" : "Open" }, { value: "closed", label: "Closed" }],
    }].filter(field => !(field.name === "state" && data.merged === true)) as ActionField[],
    run: values => write(`/${kind === "pull" ? "pulls" : "issues"}/${id}`, "PATCH", values, "内容と状態を更新しました"),
  });
  if (canWrite) {
    const [assignees, labels, milestones] = await Promise.all([list(context, `${base}/assignees`), list(context, `${base}/labels`), list(context, `${base}/milestones?state=all`)]);
    const many = (name: string, label: string, values: unknown[], current: unknown[], key: string): ActionField => ({ name, label, type: "multiselect", value: JSON.stringify(current.map(value => string(object(value)[key]))), options: [...new Map([...values, ...current].map(value => { const text = string(object(value)[key]); return [text, { value: text, label: text }]; })).values()] });
    const props = { assignees: data.assignees ?? [], labels: data.labels ?? [], milestone: data.milestone ?? null };
    actions.push({ id: "properties.update", label: "プロパティを編集", target, partial: true, version: version(data.updated_at, props), fields: [
      many("assignees", "担当者", array(assignees.data), array(props.assignees), "login"), many("labels", "ラベル", array(labels.data), array(props.labels), "name"),
      { name: "milestone", label: "Milestone", type: "select", value: String(object(data.milestone ?? {}).number ?? ""), options: [{ value: "", label: "—" }, ...array(milestones.data).map(value => ({ value: String(object(value).number), label: string(object(value).title) }))] },
    ], run: values => write(`/issues/${id}`, "PATCH", Object.fromEntries(Object.entries(values).map(([key, value]) => [key, key === "milestone" ? value ? Number(value) : null : JSON.parse(value)]))) });
    if (kind === "pull" && data.state === "open" && data.merged !== true) {
      const methods = ["merge", "squash", "rebase"].filter(value => repo[value === "merge" ? "allow_merge_commit" : `allow_${value}_merge`] === true);
      if (!data.draft && data.mergeable !== false && methods.length) actions.push({ id: "pull.merge", label: "マージ", target, confirm: true, version: version(object(data.head).sha, data.state, data.draft), fields: [{ name: "merge_method", label: "方式", type: "select", required: true, value: methods[0], options: methods.map(value => ({ value, label: value })) }],
        run: values => write(`/pulls/${id}/merge`, "PUT", { sha: string(object(data.head).sha), merge_method: values.merge_method }, "マージしました") });
      if (data.node_id) actions.push({ id: "pull.draft", label: data.draft ? "レビュー可能にする" : "Draft に戻す", target, version: version(data.draft, object(data.head).sha), fields: [],
        run: async () => { await graphql(context, `${API}/graphql`, `mutation Draft($id: ID!) { ${data.draft ? "markPullRequestReadyForReview" : "convertPullRequestToDraft"}(input: { pullRequestId: $id }) { pullRequest { id } } }`, { id: data.node_id }); return { message: "更新しました" }; } });
      const reviewers = array(data.requested_reviewers ?? []);
      actions.push({ id: "reviewers.add", label: "レビューを依頼", target, fields: [many("reviewers", "Reviewer", array(assignees.data).filter(value => object(value).login !== object(data.user).login), [], "login")], run: values => write(`/pulls/${id}/requested_reviewers`, "POST", { reviewers: JSON.parse(values.reviewers) }) });
      if (reviewers.length) actions.push({ id: "reviewers.remove", label: "レビュー依頼を解除", target, fields: [many("reviewers", "Reviewer", reviewers, [], "login")], run: values => write(`/pulls/${id}/requested_reviewers`, "DELETE", { reviewers: JSON.parse(values.reviewers) }) });
    }
  }
  if (kind === "pull" && data.state === "open" && data.merged !== true) actions.push({
    id: "review.create", label: "レビューを送信", target, version: version(object(data.head).sha),
    fields: [{ name: "event", label: "判定", type: "select", required: true, value: "COMMENT", options: [
      { value: "COMMENT", label: "Comment" }, { value: "APPROVE", label: "Approve" }, { value: "REQUEST_CHANGES", label: "Request changes" },
    ].filter(option => option.value === "COMMENT" || (!data.draft && String(object(data.user).id) !== context.user.id.slice(7))) }, { ...bodyField(), required: false }],
    run: values => {
      if (values.event !== "APPROVE" && !values.body.trim()) throw new PluginError(400, "本文を入力してください");
      if (values.event !== "COMMENT" && String(object(data.user).id) === context.user.id.slice(7)) throw new PluginError(403, "自分の PR は承認できません");
      return write(`/pulls/${id}/reviews`, "POST", { event: values.event, body: values.body, commit_id: string(object(data.head).sha) }, "レビューを送信しました");
    },
  });
  const comments = array((await list(context, `${base}/issues/${id}/comments`)).data);
  for (const value of comments) {
    const comment = object(value);
    if (!comment.user || String(object(comment.user).id) !== context.user.id.slice(7)) continue;
    const commentId = String(comment.id);
    if (!/^\d+$/.test(commentId)) throw new PluginError(502, "Invalid GitHub comment ID");
    const body = label(comment.body), revision = version(comment.updated_at, body), commentTarget = `${target} の自分のコメント: ${body.slice(0, 100)}`;
    actions.push({
      id: `comment.update/${commentId}`, label: `コメントを編集 · ${body.slice(0, 35)}`, target: commentTarget, version: revision, fields: [bodyField(body)],
      run: values => write(`/issues/comments/${commentId}`, "PATCH", { body: values.body }, "コメントを更新しました"),
    }, {
      id: `comment.delete/${commentId}`, label: `コメントを削除 · ${body.slice(0, 35)}`, target: commentTarget, version: revision, fields: [], destructive: true,
      run: () => write(`/issues/comments/${commentId}`, "DELETE", undefined, "コメントを削除しました"),
    });
  }
  const reactions = array((await list(context, `${base}/issues/${id}/reactions`)).data).map(object);
  const emojis = ["+1", "-1", "laugh", "confused", "heart", "hooray", "rocket", "eyes"];
  actions.push({ id: "issueReaction.add", label: "リアクションを追加", target, fields: [{ name: "content", label: "リアクション", type: "select", value: "+1", options: emojis.map(value => ({ value, label: value })) }], run: values => write(`/issues/${id}/reactions`, "POST", { content: values.content }) });
  for (const reaction of reactions) if (String(object(reaction.user ?? {}).id) === context.user.id.slice(7) && Number.isSafeInteger(reaction.id)) actions.push({ id: `issueReaction.delete/${reaction.id}`, label: `${reaction.content} を解除`, target, fields: [], run: () => write(`/issues/${id}/reactions/${reaction.id}`, "DELETE", undefined) });
  if (kind === "pull") {
    const groups = await Promise.all([list(context, `${base}/pulls/${id}/reviews`), list(context, `${base}/pulls/${id}/comments`)]);
    for (const [index, group] of groups.entries()) for (const value of array(group.data)) {
      const item = object(value), itemId = String(item.id), own = String(object(item.user ?? {}).id) === context.user.id.slice(7), prefix = index === 0 ? "review" : "reviewComment";
      if (!/^\d+$/.test(itemId)) throw new PluginError(502, "Invalid review ID");
      const path = index === 0 ? `/pulls/${id}/reviews/${itemId}` : `/pulls/comments/${itemId}`;
      const itemTarget = `${target} · ${label(item.body).slice(0, 80)}`;
      if (own) {
        actions.push({ id: `${prefix}.update/${itemId}`, label: "レビューを編集", target: itemTarget, version: version(item.updated_at, item.body, item.state), fields: [bodyField(label(item.body))], run: values => write(path, index === 0 ? "PUT" : "PATCH", { body: values.body }) });
        if (index === 1 || item.state === "PENDING") actions.push({ id: `${prefix}.delete/${itemId}`, label: "レビューを削除", target: itemTarget, destructive: true, version: version(item.updated_at, item.body, item.state), fields: [], run: () => write(path, "DELETE", undefined, "削除しました") });
      }
      if (index === 1 && !item.in_reply_to_id) actions.push({ id: `reviewComment.reply/${itemId}`, label: "返信", target: itemTarget, fields: [bodyField()], run: values => write(`/pulls/${id}/comments/${itemId}/replies`, "POST", { body: values.body }) });
    }
  }
  return actions;
}

export function createGitHubPlugin(options: OAuthOptions): ActionPlugin {
  return withActions({
    id: "github", name: "GitHub", icon: brandIcons.GitHub, matches: url => Boolean(parse(url)), apiOrigins: [API],
    oauth: {
      authorizationUrl: "https://github.com/login/oauth/authorize", tokenUrl: "https://github.com/login/oauth/access_token",
      ...options, scopes: ["repo", "read:user", "read:discussion", "project"],
      deviceAuthorizationUrl: options.clientSecret ? undefined : "https://github.com/login/device/code",
    },
    async identifyUser(context) {
      const user = object(await context.request(`${API}/user`));
      if (user.type !== "User" || !Number.isSafeInteger(user.id) || Number(user.id) <= 0) throw new PluginError(403, "A GitHub user account is required");
      return { id: `github:${user.id}`, name: label(user.name) || string(user.login) };
    },
    async read(url, context) {
      const route = parse(url);
      if (!route) throw new PluginError(400, "Unsupported GitHub URL");
      const { base, kind, id } = route;
      const get = async (path: string): Promise<Row> => object(await context.request(API + path));
      let data: Row, body: string | undefined, sections: Section[] = [], title = "GitHub", metadata: Row = {};
      if (["issues", "pulls", "releases", "tags", "branches", "commits", "runs", "milestones"].includes(kind)) {
        let path = kind === "runs" ? `${base}/actions/runs` : `${base}/${kind}`;
        let key = kind === "runs" ? "workflow_runs" : undefined;
        const query = url.searchParams.get("q");
        if (["issues", "pulls"].includes(kind) && query) {
          path = `/search/issues?q=${segment(`${query} repo:${route.owner}/${route.repo} is:${kind === "pulls" ? "pr" : "issue"}`)}`;
          key = "items";
        }
        const collection = await list(context, path, key);
        return view({ service: "GitHub", sourceUrl: url.href, kind, title: `${route.owner}/${route.repo} · ${kind}`, sections: [{ ...collection, title: kind }] });
      }
      if (kind === "project") {
        const result = await graphql(context, `${API}/graphql`, `query Project($owner: String!, $number: Int!) {
          owner: ${route.ownerType}(login: $owner) { projectV2(number: $number) {
            id title shortDescription readme url closed public createdAt updatedAt
            fields(first: 30) { nodes { ... on ProjectV2FieldCommon { id name dataType } } pageInfo { hasNextPage } }
            views(first: 30) { nodes { id name number layout filter } pageInfo { hasNextPage } }
          } }
        }`, { owner: route.owner, number: Number(id) });
        if (!result.owner || !object(result.owner).projectV2) throw new PluginError(404, "GitHub project not found or inaccessible");
        data = object(object(result.owner).projectV2); title = string(data.title); body = label(data.readme) || label(data.shortDescription);
        metadata = { Closed: data.closed, Public: data.public, Updated: data.updatedAt };
        const loaded = await optionalSections({ Items: () => projectItems(context, string(data.id)) });
        sections = loaded.map(section => section.data === null ? section : object(section.data) as unknown as Section);
        sections.push({ title: "Project view", data: null, note: "Projectの全項目を表示します。Viewsに記載した保存済みフィルターは適用しません。field定義・view・各項目のfield値は30件までです。" });
      } else if (kind === "milestone") {
        data = await get(`${base}/milestones/${id}`); title = string(data.title); body = label(data.description);
        metadata = { State: data.state, "Due date": data.due_on, Open: data.open_issues, Closed: data.closed_issues };
        sections = await extras(context, { Issues: `${base}/issues?milestone=${id}&state=all` });
      } else if (kind === "workflow") {
        data = await get(`${base}/actions/workflows/${segment(id!)}`); title = string(data.name);
        metadata = { State: data.state, Path: data.path };
        sections = await extras(context, { Runs: [`${base}/actions/workflows/${segment(id!)}/runs`, "workflow_runs"] });
      } else if (kind === "profile") {
        data = await get(base); title = label(data.name) || string(data.login); body = label(data.bio) || label(data.description);
        sections = await extras(context, { Repositories: `${base}/repos?sort=updated` });
      } else if (kind === "repository") {
        data = await get(base); title = string(data.full_name); body = label(data.description);
        metadata = { Language: data.language, Stars: data.stargazers_count, Forks: data.forks_count, "Open issues": data.open_issues_count, Visibility: data.visibility };
        sections = await optionalSections({
          README: async () => {
            const readme = await get(`${base}/readme`);
            return fileText(readme) ?? "The README cannot be displayed as UTF-8 text.";
          },
          Contents: async () => array(await context.request(`${API}${base}/contents`)),
        });
        sections.push(...await extras(context, { Releases: `${base}/releases`, Branches: `${base}/branches`, Contributors: `${base}/contributors` }));
      } else if (kind === "issue" || kind === "pull") {
        data = await get(`${base}/${kind === "pull" ? "pulls" : "issues"}/${id}`);
        title = `#${id} ${string(data.title)}`; body = label(data.body);
        metadata = { State: data.merged ? "merged" : data.state, Author: object(data.user).login, Created: data.created_at, Updated: data.updated_at, Draft: data.draft };
        sections = await extras(context, { Comments: `${base}/issues/${id}/comments`, Reactions: `${base}/issues/${id}/reactions`, Timeline: `${base}/issues/${id}/timeline` });
        if (kind === "pull") {
          const head = object(data.head), headSha = segment(string(head.sha));
          sections.push(...await extras(context, { Reviews: `${base}/pulls/${id}/reviews`, "Review comments": `${base}/pulls/${id}/comments`, "Changed files / diff": `${base}/pulls/${id}/files`, Commits: `${base}/pulls/${id}/commits`, Checks: [`${base}/commits/${headSha}/check-runs`, "check_runs"] }));
          sections.push(...await optionalSections({ "Commit status": () => get(`${base}/commits/${headSha}/status`) }));
        }
      } else if (kind === "commit" || kind === "compare") {
        data = await get(`${base}/${kind === "commit" ? "commits" : "compare"}/${segment(id!)}`);
        body = kind === "commit" ? label(object(data.commit).message) : label(data.status);
        title = kind === "commit" ? `Commit ${id}` : `Compare ${id}`;
        sections = [{ title: "Changed files / diff", data: array(data.files ?? []), note: "GitHub may omit patches for binary or large files; compare results include at most 300 files." }];
        if (kind === "compare") sections.push(...await extras(context, { Commits: [`${base}/compare/${segment(id!)}`, "commits"] }));
        else {
          sections[0] = { ...await list(context, `${base}/commits/${segment(id!)}`, "files"), title: "Changed files / diff" };
          sections.push(...await extras(context, { Comments: `${base}/commits/${segment(id!)}/comments`, Checks: [`${base}/commits/${segment(id!)}/check-runs`, "check_runs"] }));
        }
      } else if (kind === "blob" || kind === "tree") {
        const result = await contents(context, route);
        title = `${route.owner}/${route.repo} · ${result.path || result.ref}`;
        metadata = { Ref: result.ref, Path: result.path };
        if (Array.isArray(result.data)) return view({ service: "GitHub", sourceUrl: url.href, kind, title, metadata, sections: [{ title: "Directory", data: result.data, note: result.data.length >= 1000 ? "GitHub directory listings are limited to 1,000 entries." : undefined }] });
        data = object(result.data); body = fileText(data);
        if (body === undefined) sections.push({ title: "File preview", data: null, note: "Binary, large, or non-UTF-8 file. Open the source URL to view or download it." });
        data = { ...data, content: undefined };
      } else if (kind === "release") {
        data = await get(`${base}/releases/${id ? `tags/${segment(id)}` : "latest"}`);
        title = label(data.name) || string(data.tag_name); body = label(data.body);
        sections = [{ title: "Assets", data: array(data.assets) }];
      } else if (kind === "run" || kind === "job") {
        data = await get(`${base}/actions/${kind === "run" ? "runs" : "jobs"}/${id}`);
        title = label(data.display_title) || string(data.name);
        metadata = { Status: data.status, Conclusion: data.conclusion, Branch: data.head_branch, Event: data.event };
        sections = kind === "run" ? await extras(context, { Jobs: [`${base}/actions/runs/${id}/jobs`, "jobs"], Artifacts: [`${base}/actions/runs/${id}/artifacts`, "artifacts"] }) : [{ title: "Steps", data: array(data.steps) }];
      } else if (kind === "gist") {
        data = await get(base + (id ? `/${segment(id)}` : ""));
        title = label(data.description) || "Gist";
        sections = [{ title: "Files", data: Object.values(object(data.files)), note: "Truncated files are not downloaded; open the Gist for full contents." }, ...await extras(context, { Comments: `${base}/comments` })];
      } else if (kind === "discussions") {
        const result = await graphql(context, `${API}/graphql`, `query Discussion($owner: String!, $repo: String!, $number: Int!) {
          repository(owner: $owner, name: $repo) { discussion(number: $number) {
            id title body url createdAt updatedAt isAnswered upvoteCount author { login } category { name }
            answer { body createdAt author { login } }
          } }
        }`, { owner: route.owner, repo: route.repo, number: Number(id) });
        data = object(object(result.repository).discussion); title = string(data.title); body = label(data.body);
        const comments: unknown[] = []; let cursor: string | undefined;
        sections = await optionalSections({ Comments: async () => {
          for (let page = 0; page < MAX_PAGES; page++) {
            let response: Row;
            try { response = await graphql(context, `${API}/graphql`, `query Comments($owner: String!, $repo: String!, $number: Int!, $after: String) {
              repository(owner: $owner, name: $repo) { discussion(number: $number) { comments(first: 30, after: $after) {
                nodes { body createdAt url author { login } replies(first: 30) { nodes { body createdAt url author { login } } pageInfo { hasNextPage } } }
                pageInfo { hasNextPage endCursor }
              } } }
            }`, { owner: route.owner, repo: route.repo, number: Number(id), after: cursor }); }
            catch (error) { return partialPage(error, comments, "Comments"); }
            const connection = object(object(object(response.repository).discussion).comments);
            comments.push(...array(connection.nodes));
            if (!object(connection.pageInfo).hasNextPage) break;
            const next = string(object(connection.pageInfo).endCursor);
            if (next === cursor) throw new PluginError(502, "GitHub pagination did not advance");
            cursor = next;
          }
          return { title: "Comments", data: comments };
        } });
        sections = sections.map(section => section.data === null ? section : object(section.data) as unknown as Section);
        sections.push({ title: "Discussion pagination", data: null, note: "At most 90 comments and 30 replies per comment are shown. Open GitHub for the full conversation." });
      } else throw new PluginError(400, "Unsupported GitHub URL");
      sections.unshift({ title: "Details", data });
      return view({ service: "GitHub", sourceUrl: url.href, kind, context: route.repo ? `${route.owner}/${route.repo}` : route.owner, title, body, metadata, sections });
    },
  }, githubActions);
}
