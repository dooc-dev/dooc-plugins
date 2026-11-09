import { withActions, bodyField, titleField, version, type ActionContext, type ActionField, type ActionPlugin, type BoundAction } from "./actions.js";
import { PluginError, type PluginContext } from "@dooc-dev/dooc-plugin";
import { brandIcons } from "./brand-icons.js";
import { array, connection, graphql, label, MAX_PAGES, MORE, object, optionalSections, partialPage, pathParts, string, view, type OAuthOptions, type Row, type Section } from "./common.js";

const API = "https://api.linear.app/graphql";
const person = "id name displayName";
const issue = `id identifier title url priority priorityLabel dueDate estimate state { id name type } assignee { ${person} }`;
const project = `id name url description progress targetDate status { id name } lead { ${person} }`;
const document = "id title url updatedAt";
const comment = `id body url createdAt updatedAt user { ${person} } parent { id } reactionData`;
const cycle = "id number name description startsAt endsAt progress isActive";
const update = `id body url createdAt health user { ${person} } reactionData`;
const pageInfo = "pageInfo { hasNextPage endCursor }";
const titles: Record<string, string> = {
  comments: "Comments", attachments: "Attachments", children: "Sub-issues", labels: "Labels", relations: "Related issues",
  inverseRelations: "Incoming relations", history: "Activity", documents: "Documents", issues: "Issues", projectUpdates: "Project updates",
  projectMilestones: "Milestones", members: "Members", teams: "Teams", externalLinks: "Links", uncompletedIssuesUponClose: "Uncompleted issues at close",
  projects: "Projects", cycles: "Cycles", states: "Workflow states", initiativeUpdates: "Initiative updates", links: "Links", initiatives: "Initiatives",
};

const definitions: Record<string, { fields: string; collections: Record<string, string> }> = {
  issue: {
    fields: `${issue} description createdAt updatedAt completedAt canceledAt archivedAt branchName reactionData
      creator { ${person} } team { id key name } project { id name url } cycle { ${cycle} }
      parent { ${issue} } projectMilestone { id name targetDate }`,
    collections: {
      comments: comment, attachments: "id title subtitle url sourceType metadata", children: issue,
      labels: "id name color", relations: `type relatedIssue { ${issue} }`, inverseRelations: `type issue { ${issue} }`,
      history: `id createdAt actor { ${person} } fromTitle toTitle fromState { name } toState { name }
        fromAssignee { name } toAssignee { name } fromPriority toPriority fromDueDate toDueDate updatedDescription`,
      documents: document,
    },
  },
  project: {
    fields: `${project} content createdAt updatedAt startDate completedAt health priorityLabel slugId creator { ${person} }`,
    collections: {
      issues: issue, projectUpdates: update, projectMilestones: "id name description targetDate progress status",
      documents: document, members: person, teams: "id key name", labels: "id name color",
      externalLinks: "id label url", comments: comment,
    },
  },
  cycle: {
    fields: `${cycle} createdAt updatedAt completedAt team { id key name } issueCountHistory completedIssueCountHistory`,
    collections: { issues: issue, uncompletedIssuesUponClose: issue, documents: document },
  },
  team: {
    fields: `id key name description timezone visibility issueCount activeCycle { ${cycle} }`,
    collections: { issues: issue, projects: project, cycles: cycle, members: person, labels: "id name color", states: "id name type color" },
  },
  document: {
    fields: `${document} content createdAt slugId creator { ${person} } updatedBy { ${person} }
      project { id name url } initiative { id name url } issue { id identifier title url }`,
    collections: { comments: comment },
  },
  initiative: {
    fields: `id name url description content status health targetDate createdAt updatedAt owner { ${person} }`,
    collections: { projects: project, documents: document, initiativeUpdates: update, links: "id label url" },
  },
  customView: {
    fields: `id name description modelName updatedAt owner { ${person} } team { id key name }`,
    collections: { issues: issue, projects: project, initiatives: "id name url description status targetDate" },
  },
};

type Route = { kind: string; id: string; workspace: string; team?: string; cycleNumber?: number; slug?: boolean; activeCycle?: boolean };
const uuid = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
function identifier(value: string): { id: string; slug?: boolean } | undefined {
  if (uuid.test(value)) return { id: value };
  const slug = value.match(/(?:^|-)([a-f\d]{12})$/i)?.[1];
  if (slug) return { id: slug, slug: true };
}

function parse(url: URL): Route | undefined {
  if (url.hostname !== "linear.app") return;
  const p = pathParts(url);
  if (!p || p.length < 3 || !/^[\w-]+$/.test(p[0])) return;
  const workspace = p[0];
  if (p[1] === "issue" && p.length <= 4 && /^[a-z][a-z\d]*-\d+$/i.test(p[2])) return { kind: "issue", id: p[2], workspace };
  if (p[1] === "team" && /^[\w-]+$/.test(p[2])) {
    if (p.length === 3 || (p.length === 4 && ["all", "active", "backlog", "issues", "projects", "cycles", "triage"].includes(p[3]))) return { kind: "team", id: p[2], workspace };
    if (["cycle", "cycles"].includes(p[3]) && p.length === 5) {
      if (p[4] === "active" || p[4] === "current") return { kind: "cycle", id: "", workspace, team: p[2], activeCycle: true };
      if (/^\d+$/.test(p[4]) && Number.isSafeInteger(Number(p[4]))) return { kind: "cycle", id: "", workspace, team: p[2], cycleNumber: Number(p[4]) };
      if (uuid.test(p[4])) return { kind: "cycle", id: p[4], workspace, team: p[2] };
    }
  }
  const kinds: Record<string, string> = { project: "project", initiative: "initiative", document: "document", view: "customView" };
  const kind = kinds[p[1]];
  if (kind && (p.length === 3 || (p.length === 4 && ["overview", "updates", "issues", "projects", "resources"].includes(p[3])))) {
    const parsed = identifier(p[2]);
    if (parsed) return { kind, workspace, ...parsed };
  }
  if (p[1] === "project" && p[3] === "document" && p.length === 5) {
    const parsed = identifier(p[4]);
    if (parsed) return { kind: "document", workspace, ...parsed };
  }
}

async function resolve(context: PluginContext, route: Route): Promise<Row> {
  const { kind, id, slug } = route, { fields } = definitions[kind];
  let root = `${kind}(id: $id)`, variables: Row = { id }, declaration = "$id: String!", multiple = false;
  if (kind === "team") {
    root = "teams(filter: { key: { eq: $id } }, first: 1)"; multiple = true;
  } else if (kind === "cycle" && (route.cycleNumber !== undefined || route.activeCycle)) {
    root = `cycles(filter: { team: { key: { eq: $team } }, ${route.activeCycle ? "isActive: { eq: true }" : "number: { eq: $number }"} }, first: 1)`;
    declaration = `$team: String!${route.activeCycle ? "" : ", $number: Float!"}`;
    variables = { team: route.team, ...(route.activeCycle ? {} : { number: route.cycleNumber }) }; multiple = true;
  } else if (slug && ["project", "initiative", "document"].includes(kind)) {
    root = `${kind}s(filter: { slugId: { eq: $id } }, first: 1, includeArchived: true)`; multiple = true;
  }
  const data = await graphql(context, API, `query Resource(${declaration}) { resource: ${root} { ${multiple ? `nodes { ${fields} }` : fields} } }`, variables);
  const resource = multiple ? array(object(data.resource).nodes)[0] : data.resource;
  if (!resource) throw new PluginError(404, "Linear resource not found or inaccessible");
  return object(resource);
}

async function related(context: PluginContext, kind: string, id: string, field: string, fields: string): Promise<Section> {
  const nodes: unknown[] = []; let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    let data: Row;
    try {
      data = await graphql(context, API, `query Related($id: String!, $after: String) {
        resource: ${kind}(id: $id) { collection: ${field}(first: 30, after: $after) { nodes { ${fields} } ${pageInfo} } }
      }`, { id, after: cursor });
    } catch (error) { return partialPage(error, nodes, field); }
    const result = connection(object(data.resource).collection);
    nodes.push(...result.nodes);
    if (!result.cursor) return { title: field, data: nodes };
    if (result.cursor === cursor) throw new PluginError(502, "Linear pagination did not advance");
    cursor = result.cursor;
  }
  return { title: field, data: nodes, note: MORE };
}

async function linearActions(url: URL, context: ActionContext): Promise<BoundAction[]> {
  const route = parse(url);
  if (!route) return [];
  const identity = context.user.id.split(":");
  if (identity.length !== 4 || identity[0] !== "linear" || identity[2] !== route.workspace)
    throw new PluginError(403, "Connect Linear with the workspace in this URL");
  const mutate = async (query: string, variables: Row, message: string, deleted = false) => {
    const result = await graphql(context, API, query, variables);
    if (object(result.result).success !== true) throw new PluginError(502, "Linear の操作が完了しませんでした");
    return { message, ...(deleted ? { deleted } : {}) };
  };
  if (route.kind !== "issue") {
    if (!["project", "cycle", "document", "initiative", "team", "customView"].includes(route.kind)) return [];
    const data = await resolve(context, route), id = string(data.id), kind = route.kind;
    const titleKey = kind === "document" ? "title" : "name", bodyKey = ["document", "project", "initiative"].includes(kind) ? "content" : "description";
    const fields: ActionField[] = [{ ...titleField(label(data[titleKey])), name: titleKey }, { ...bodyField(label(data[bodyKey])), name: bodyKey, required: false }];
    if (kind === "project") {
      const choices = await graphql(context, API, `query ProjectOptions { projectStatuses(first: 100) { nodes { id name } } users(first: 100) { nodes { id name } } }`);
      for (const [key, title, source, current] of [["statusId", "状態", "projectStatuses", "status"], ["leadId", "担当者", "users", "lead"]]) {
        const selected = object(data[current] ?? {});
        const options = [...new Map([...array(object(choices[source]).nodes), ...(selected.id ? [selected] : [])].map(value => { const item = object(value); return [string(item.id), { value: string(item.id), label: string(item.name) }]; })).values()];
        fields.push({ name: key, label: title, type: "select", value: label(selected.id), options: [{ value: "", label: "—" }, ...options] });
      }
      fields.push({ name: "startDate", label: "開始日", type: "date", value: label(data.startDate) }, { ...bodyField(label(data.description)), name: "description", label: "概要", required: false });
    }
    if (["project", "initiative"].includes(kind)) fields.push({ name: "targetDate", label: "期限", type: "date", value: label(data.targetDate) });
    if (kind === "cycle") for (const [key, title] of [["startsAt", "開始日"], ["endsAt", "終了日"]]) fields.push({ name: key, label: title, type: "date", required: true, value: label(data[key]).slice(0, 10) });
    const target = label(data[titleKey]) || kind, type = `${kind[0].toUpperCase()}${kind.slice(1)}UpdateInput`;
    const actions: BoundAction[] = [{ id: "resource.update", label: "編集", target, partial: true, version: version(data), fields,
      run: values => {
        const input: Row = { ...values };
        if (kind === "cycle") {
          if ((values.startsAt ?? label(data.startsAt).slice(0, 10)) >= (values.endsAt ?? label(data.endsAt).slice(0, 10))) throw new PluginError(400, "終了日は開始日より後にしてください");
          for (const key of ["startsAt", "endsAt"]) if (key in values) input[key] = `${values[key]}T00:00:00.000Z`;
        }
        if ("targetDate" in input) input.targetDate ||= null;
        for (const key of ["startDate", "leadId", "statusId"]) if (key in input) input[key] ||= null;
        return mutate(`mutation UpdateResource($id: String!, $input: ${type}!) { result: ${kind}Update(id: $id, input: $input) { success } }`, { id, input }, "更新しました");
      },
    }];
    if (kind === "project") actions.push({ id: "projectUpdate.create", label: "進捗を投稿", target, fields: [bodyField(), { name: "health", label: "Health", type: "select", value: "onTrack", options: ["onTrack", "atRisk", "offTrack"].map(value => ({ value, label: value })) }],
      run: values => mutate(`mutation CreateProjectUpdate($input: ProjectUpdateCreateInput!) { result: projectUpdateCreate(input: $input) { success } }`, { input: { projectId: id, ...values } }, "投稿しました"),
    });
    return actions;
  }
  const response = await graphql(context, API, `query ActionIssue($id: String!) {
    issue(id: $id) { id identifier title description updatedAt priority dueDate estimate state { id name }
      assignee { id name } project { id name } cycle { id name number } labels { nodes { id name } }
      team { id states(first: 50) { nodes { id name } } members(first: 100) { nodes { id name } }
        labels(first: 100, includeArchived: false) { nodes { id name } } projects(first: 100) { nodes { id name } } cycles(first: 100) { nodes { id name number } } }
      comments(first: 50) { nodes { id body updatedAt user { id name } } }
    }
  }`, { id: route.id });
  const data = object(response.issue), id = string(data.id), target = `${data.identifier} · ${data.title}`;
  const choices = (field: string, current: unknown[] = []) => [...new Map([...array(object(object(data.team)[field]).nodes), ...current].map(value => {
    const item = object(value); return [string(item.id), { value: string(item.id), label: label(item.name) || `Cycle ${item.number}` }];
  })).values()];
  const select = (name: string, label: string, source: string, selected: Row): ActionField => ({ name, label, type: "select", value: String(selected.id ?? ""), options: [{ value: "", label: "—" }, ...choices(source, selected.id ? [selected] : [])] });
  const actions: BoundAction[] = [{
    id: "comment.create", label: "コメントを投稿", target, fields: [bodyField()],
    run: values => mutate(`mutation CreateComment($input: CommentCreateInput!) { result: commentCreate(input: $input) { success } }`, { input: { issueId: id, body: values.body } }, "コメントを投稿しました"),
  }, {
    id: "issue.update", label: "Issue を編集", target, partial: true, version: version(data.updatedAt, data.title, data.description, data.state, data.priority, data.assignee, data.labels, data.project, data.cycle, data.dueDate, data.estimate),
    fields: [titleField(string(data.title)), { ...bodyField(label(data.description)), label: "説明", required: false }, {
      name: "state", label: "状態", type: "select", required: true, value: string(object(data.state).id),
      options: array(object(object(data.team).states).nodes).map(value => ({ value: string(object(value).id), label: string(object(value).name) })),
    }, { name: "priority", label: "優先度", type: "select", value: String(data.priority ?? 0), options: ["—", "Urgent", "High", "Medium", "Low"].map((label, value) => ({ value: String(value), label })) },
    select("assigneeId", "担当者", "members", object(data.assignee ?? {})), select("projectId", "Project", "projects", object(data.project ?? {})), select("cycleId", "Cycle", "cycles", object(data.cycle ?? {})),
    { name: "labelIds", label: "ラベル", type: "multiselect", value: JSON.stringify(array(object(data.labels).nodes).map(value => string(object(value).id))), options: choices("labels", array(object(data.labels).nodes)) },
    { name: "dueDate", label: "期限", type: "date", value: label(data.dueDate) }, { name: "estimate", label: "見積", type: "number", min: 0, max: 1000, value: data.estimate == null ? "" : String(data.estimate) }],
    run: values => {
      if (values.estimate && !Number.isInteger(Number(values.estimate))) throw new PluginError(400, "見積は整数で指定してください");
      return mutate(`mutation UpdateIssue($id: String!, $input: IssueUpdateInput!) { result: issueUpdate(id: $id, input: $input) { success } }`, { id, input: {
      ...("title" in values ? { title: values.title } : {}), ...("body" in values ? { description: values.body } : {}), ...("state" in values ? { stateId: values.state } : {}),
      ...Object.fromEntries(Object.entries(values).filter(([key]) => !["title", "body", "state"].includes(key)).map(([key, value]) => [key, key === "labelIds" ? JSON.parse(value) : ["priority", "estimate"].includes(key) ? value === "" ? null : Number(value) : value || null])),
    } }, "Issue を更新しました"); },
  }, {
    id: "issue.delete", label: "Issue を削除", target, destructive: true, fields: [], version: version(data.updatedAt, data.title, data.description, data.state),
    run: () => mutate(`mutation DeleteIssue($id: String!) { result: issueDelete(id: $id, permanentlyDelete: false) { success } }`, { id }, "Issue を削除しました", true),
  }];
  for (const value of array(object(data.comments).nodes)) {
    const comment = object(value);
    if (!comment.user || object(comment.user).id !== identity[3]) continue;
    const commentId = string(comment.id), body = label(comment.body), revision = version(comment.updatedAt, body);
    const commentTarget = `${target} の自分のコメント: ${body.slice(0, 100)}`;
    actions.push({
      id: `comment.update/${commentId}`, label: `コメントを編集 · ${body.slice(0, 35)}`, target: commentTarget, version: revision, fields: [bodyField(body)],
      run: values => mutate(`mutation UpdateComment($id: String!, $input: CommentUpdateInput!) { result: commentUpdate(id: $id, input: $input) { success } }`, { id: commentId, input: { body: values.body } }, "コメントを更新しました"),
    }, {
      id: `comment.delete/${commentId}`, label: `コメントを削除 · ${body.slice(0, 35)}`, target: commentTarget, version: revision, destructive: true, fields: [],
      run: () => mutate(`mutation DeleteComment($id: String!) { result: commentDelete(id: $id) { success } }`, { id: commentId }, "コメントを削除しました"),
    });
  }
  return actions;
}

export function createLinearPlugin(options: OAuthOptions): ActionPlugin {
  return withActions({
    id: "linear", name: "Linear", icon: brandIcons.Linear, matches: url => Boolean(parse(url)), apiOrigins: ["https://api.linear.app"],
    oauth: {
      authorizationUrl: "https://linear.app/oauth/authorize", tokenUrl: "https://api.linear.app/oauth/token",
      ...options, scopes: ["read", "write"], scopeSeparator: ",", authorizationParams: { actor: "user" },
    },
    async identifyUser(context) {
      const result = await graphql(context, API, "query Identity { viewer { id name app active organization { id urlKey } } }");
      const user = object(result.viewer), org = object(user.organization);
      if (user.app !== false || user.active !== true) throw new PluginError(403, "An active Linear user account is required");
      return { id: `linear:${string(org.id)}:${string(org.urlKey)}:${string(user.id)}`, name: string(user.name) };
    },
    async read(url, context) {
      const route = parse(url);
      if (!route) throw new PluginError(400, "Unsupported Linear URL");
      const identity = context.user.id.split(":");
      if (identity.length !== 4 || identity[0] !== "linear" || identity[2] !== route.workspace)
        throw new PluginError(403, "Connect Linear with the workspace in this URL");
      const data = await resolve(context, route);
      const id = string(data.id);
      const tasks = Object.fromEntries(Object.entries(definitions[route.kind].collections).map(([field, fields]) =>
        [field, () => related(context, route.kind, id, field, fields)]));
      const sections = (await optionalSections(tasks)).map(section => ({
        ...(section.data === null ? section : object(section.data)), title: titles[section.title],
      } as Section));
      sections.unshift({ title: "Details", data });
      if (route.kind === "team") sections.unshift({ title: "Team scope", data: null, note: "Shows the team's issues and projects. UI-only filters in the source URL are not applied." });
      const state = data.state ?? data.status;
      const metadata = {
        Status: state && typeof state === "object" ? object(state).name : state,
        Priority: data.priorityLabel, "Due date": data.dueDate ?? data.targetDate,
        Assignee: data.assignee ? object(data.assignee).name : undefined,
        Lead: data.lead ? object(data.lead).name : undefined,
        Starts: data.startsAt, Ends: data.endsAt,
        Progress: typeof data.progress === "number" ? `${Math.round(data.progress * 100)}%` : undefined,
        Updated: data.updatedAt,
      };
      const title = [label(data.identifier), label(data.title) || label(data.name) || (route.kind === "cycle" ? `Cycle ${data.number}` : route.kind)].filter(Boolean).join(" · ");
      return view({ service: "Linear", sourceUrl: url.href, kind: route.kind, context: label(data.project && object(data.project).name) || label(data.team && object(data.team).name), title, body: label(data.content) || label(data.description), metadata, sections });
    },
  }, linearActions);
}
