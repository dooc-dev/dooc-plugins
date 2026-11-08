import type { PluginBlock, PluginBlockContent, PluginCell, PluginEdit, PluginInline, PluginTone } from "@sasaki-s-sci/dooc-plugin";
import type { Row, Section } from "./common.js";
import { brandIcons } from "./brand-icons.js";

export type CardView = PluginBlockContent & { collapsed: PluginBlockContent };
const row = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const name = (value: unknown): string => typeof value === "string" ? value : String(row(value).display_name ?? row(value).name ?? row(value).login ?? "");
const present = (value: unknown): boolean => value !== undefined && value !== null && value !== "";
const tone = (value: unknown): PluginTone => {
  const text = name(value).toLowerCase().replaceAll("_", " ");
  if (/^(success|approved|done|completed|resolved|merged|closed)$/.test(text)) return "success";
  if (/^(failure|failed|error|changes requested|urgent|high|blocked)$/.test(text)) return "warning";
  if (/^(open|in progress|started|in review|in flight|pending|queued)$/.test(text)) return "accent";
  return "neutral";
};
const emojis: Record<string, string> = { tada: "🎉", white_check_mark: "✅", "+1": "👍", thumbsup: "👍", "-1": "👎", eyes: "👀", rocket: "🚀", heart: "❤️", fire: "🔥", smile: "😄", hooray: "🎉", laugh: "😄", confused: "😕" };
function date(value: unknown): string {
  const raw = String(value ?? "");
  const parsed = typeof value === "number" || /^\d{10,}\.\d{6}$/.test(raw) ? new Date(Number(value) * 1000) : new Date(raw);
  if (!Number.isFinite(parsed.getTime())) return raw;
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : `${parsed.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}
function safeUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 4096 || /[\s\\]/.test(value)) return;
  try { const url = new URL(value); if (url.protocol === "https:" && !url.username && !url.password) return url.href; } catch { /* Provider text is not necessarily a URL. */ }
}

export function view(input: { service: string; title: string; body?: string; metadata?: Row; sections?: Section[]; kind?: string; context?: string; viewerId?: string; sourceUrl?: string }): CardView {
  let remaining = 140_000, truncated = false;
  const text = (value: unknown, limit = 20_000): string => {
    const original = value && typeof value === "object" ? name(value) : String(value ?? ""), part = original.slice(0, Math.max(0, Math.min(limit, remaining)));
    remaining -= part.length;
    if (part.length < original.length) truncated = true;
    return part + (part.length < original.length ? "…" : "");
  };
  const rich = (value: unknown): string => {
    const raw = text(value && typeof value === "object" ? row(value).text ?? row(value).value ?? "" : value);
    return input.service === "Slack" ? raw.replace(/<(https?:\/\/[^|>]+)\|([^>]+)>/g, "[$2]($1)").replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, "**$1**") : raw;
  };
  const sections = input.sections ?? [], resource = row(sections.find(s => s.title === "Details")?.data);
  const find = (title: string): unknown => sections.find(s => s.title === title)?.data;
  const meta = { ...input.metadata }, linear = input.service === "Linear", github = input.service === "GitHub", isPull = github && input.kind === "pull";
  const issueId = linear ? name(resource.identifier) : "";
  const number = github ? /^#(\d+) /.exec(input.title)?.[1] : undefined;
  const displayTitle = issueId && input.title.startsWith(`${issueId} · `) ? input.title.slice(issueId.length + 3) : number ? input.title.replace(/^#\d+ /, "") : input.kind === "message" ? input.title.replace(/^Message · /, "") : input.title;
  const title = text(displayTitle, 500);
  const update = linear && input.kind === "issue" ? "issue.update" : "resource.update";
  const edit = (field: string, action = update): PluginEdit => ({ action, field });
  const titleField = linear && input.kind !== "issue" && input.kind !== "document" || github && input.kind === "release" ? "name" : "title";
  const bodyField = linear && input.kind !== "issue" ? ["document", "project", "initiative"].includes(input.kind ?? "") ? "content" : "description" : github && input.kind === "project" ? "readme" : github && input.kind === "milestone" ? "description" : "body";
  const pill = (value: unknown): PluginInline => ({ text: text(name(value).replaceAll("_", " ") || "—", 150), tone: tone(value) });
  const status = isPull && meta.Draft === true ? "Draft" : meta.Conclusion ?? meta.Status ?? meta.State;
  const badge = pill(status);
  const workspace = /^https:\/\/linear\.app\/([a-z\d-]+)\//i.exec(input.sourceUrl ?? "")?.[1];
  const issueUrl = (r: Row) => workspace && /^[a-z\d]+-\d+$/i.test(String(r.identifier ?? "")) ? `https://linear.app/${workspace}/issue/${encodeURIComponent(String(r.identifier))}` : undefined;
  const link = (r: Row, value: unknown): PluginInline => {
    const url = safeUrl(r.identifier && linear ? issueUrl(r) : r.html_url ?? r.details_url ?? r.url ?? r.web_url ?? r.permalink ?? r.browser_download_url ?? r.link);
    return { text: text(value, 500), ...(url ? { url } : {}) };
  };
  const copy = (value: unknown): PluginInline => ({ text: text(value, 500), copy: text(value, 4000), code: true });
  const person = (value: unknown) => link(row(value), name(value) || "—");
  const fields: (PluginCell & { label: string })[] = [];
  const property = (label: string, items: PluginInline[], field?: string, action = update) => fields.push({ label, items, ...(field ? { edit: edit(field, action) } : {}) });
  const names: Record<string, string> = { Status: input.kind === "project" ? "statusId" : "state", Lead: "leadId", State: "state", Priority: "priority", Assignee: "assigneeId", "Due date": input.kind === "issue" ? "dueDate" : "targetDate", Estimate: "estimate", Project: "projectId", Cycle: "cycleId", Starts: "startsAt", Ends: "endsAt", Closed: "closed" };
  if (present(status) || linear) property("Status", [badge], input.kind === "project" && linear ? "statusId" : "state");
  const skip = new Set(["Created", "Updated", "Timestamp", "Edited", "Progress", "Draft", "Author", "State", "Status", "Conclusion", ...(input.kind === "message" ? ["Channel", "Replies"] : [])]);
  for (const [key, value] of Object.entries(meta)) if (!skip.has(key) && present(value)) property(key,
    [key === "Priority" ? pill(value) : typeof value === "boolean" ? value ? "Yes" : "No" : key === "Size" && typeof value === "number" ? `${Math.ceil(value / 1024)} KB` : text(["Due date", "Starts", "Ends"].includes(key) ? date(value) : value, 500)], names[key]);
  if (linear && input.kind === "issue") {
    for (const [key, label, field] of [["assignee", "Assignee", "assigneeId"], ["project", "Project", "projectId"], ["cycle", "Cycle", "cycleId"], ["parent", "Parent", ""], ["projectMilestone", "Milestone", ""]]) {
      if (key === "assignee" && present(meta.Assignee)) continue;
      const r = row(resource[key]); property(label, [link(r, r.name ?? r.title ?? (r.number ? `Cycle ${r.number}` : "—"))], field);
    }
    if (!present(meta.Priority)) property("Priority", ["—"], "priority");
    if (!present(meta["Due date"])) property("Due date", ["—"], "dueDate");
    property("Estimate", [text(resource.estimate ?? "—")], "estimate");
    if (resource.branchName) property("Branch", [copy(resource.branchName)]);
  }
  const labels = [...list(find("Labels")), ...list(resource.labels)];
  if (labels.length || input.kind === "issue" || isPull) property("Labels", labels.map(pill), linear ? "labelIds" : "labels", linear ? update : "properties.update");
  if (github && (isPull || input.kind === "issue")) {
    property("Assignees", list(resource.assignees).map(person), "assignees", "properties.update");
    property("Milestone", [link(row(resource.milestone), row(resource.milestone).title ?? "—")], "milestone", "properties.update");
    if (isPull) {
      property("Reviewers", [...list(resource.requested_reviewers), ...list(resource.requested_teams)].map(person));
      if (present(resource.mergeable_state)) property("Merge", [pill(resource.mergeable_state)]);
    }
  }
  if (meta.Author && input.kind !== "message") property("Author", [text(meta.Author, 150)]);
  if (resource.sha && !input.title.includes(String(resource.sha))) property("SHA", [copy(resource.sha)]);
  if (resource.tag_name) property("Tag", [copy(resource.tag_name)]);
  if (resource.profile) for (const [key, label] of [["email", "Email"], ["title", "Role"], ["phone", "Phone"], ["status_text", "Status"]]) {
    const value = row(resource.profile)[key]; if (value) property(label, [key === "email" || key === "phone" ? copy(value) : text(value, 300)]);
  }
  const people = new Map<string, string>();
  for (const value of [...list(find("Thread")), ...list(find("Messages"))]) { const r = row(value); if (r.user && r.author) people.set(String(r.user), name(r.author)); }
  const reactions = (data: unknown, interactive = false): Extract<PluginBlock, { type: "message" }>["reactions"] => {
    const counts = new Map<string, number>(), active = new Set<string>();
    for (const value of list(data).slice(0, 100)) {
      const r = row(value), key = String(r.name ?? r.content ?? r.emoji ?? ""), count = Number(r.count ?? 1);
      if (key && Number.isFinite(count)) counts.set(key, (counts.get(key) ?? 0) + Math.max(0, Math.floor(count)));
      if (input.viewerId && (list(r.users).includes(input.viewerId) || String(row(r.user).id) === input.viewerId)) active.add(key);
    }
    return [...counts].map(([key, count]) => ({ label: emojis[key] ?? `:${key}:`, count, active: active.has(key),
      ...(interactive ? { action: active.has(key) ? "reaction.remove" : "reaction.add", values: { emoji: key } } : {}) }));
  };
  const message = (r: Row, section = "", root = false): PluginBlock[] => {
    const id = text(r.ts ?? r.id ?? "", 200), prefix = input.service === "Slack" ? "message" : section === "Reviews" ? "review" : section === "Review comments" ? "reviewComment" : "comment";
    const author = name(r.author) || (typeof r.user === "string" ? people.get(r.user) : "") || name(r.user) || name(r.username) || "—";
    const stamp = r.ts ?? r.createdAt ?? r.created_at ?? r.submitted_at;
    const blocks: PluginBlock[] = [];
    if (r.path) blocks.push({ type: "context", items: [copy(r.path), text(r.line ?? "")] });
    blocks.push({ type: "message", author: text(author, 150), text: rich(root ? input.body : r.text ?? r.body),
      ...(stamp ? { time: date(stamp) } : {}), ...(id ? { edit: { action: `${prefix}.update/${id}` }, actions: [`${prefix}.delete/${id}`, ...(section === "Review comments" ? [`reviewComment.reply/${id}`] : [])] } : {}),
      reactions: reactions(r.reactions ?? r.reactionData, root && input.service === "Slack") });
    const replies = list(row(r.replies).nodes);
    if (replies.length) blocks.push({ type: "section", title: `Replies (${replies.length})`, collapsed: true, blocks: replies.slice(0, 30).flatMap(v => message(row(v), section)) });
    return blocks;
  };
  const normalize = (value: unknown): Row => {
    let r = row(value); if (r.message) r = row(r.message); if (r.relatedIssue || r.issue) r = { ...r, ...row(r.relatedIssue ?? r.issue) };
    const title = r.title ?? r.display_title ?? r.name ?? r.filename ?? row(r.commit).message ?? r.label ?? r.login ?? r.context ?? r.event ?? r.identifier ?? (r.fromState || r.toState ? "Status" : typeof value === "object" ? "—" : value);
    const changes = [r.fromState && r.toState ? `${name(r.fromState)} → ${name(r.toState)}` : "", r.fromAssignee || r.toAssignee ? `${name(r.fromAssignee) || "—"} → ${name(r.toAssignee) || "—"}` : "", r.fromTitle || r.toTitle ? `${r.fromTitle || "—"} → ${r.toTitle || "—"}` : "", r.fromPriority !== undefined || r.toPriority !== undefined ? `${r.fromPriority ?? "—"} → ${r.toPriority ?? "—"}` : ""].filter(Boolean).join(" · ");
    return { ...r, title, state: r.conclusion ?? r.state ?? r.status ?? r.issueState ?? r.pullRequestState, assignee: r.assignee ?? r.author ?? r.actor ?? r.lead, dueDate: r.dueDate ?? r.targetDate ?? r.due_on, size: r.size ?? r.size_in_bytes, type: r.type ?? r.layout ?? r.dataType, date: r.createdAt ?? r.created_at ?? r.updatedAt ?? r.updated_at ?? r.started_at, detail: changes || r.description || r.subtitle || r.mimetype || r.filter || r.body };
  };
  const columnLabel: Record<string, string> = { title: "Name", state: "Status", assignee: "Assignee", priorityLabel: "Priority", dueDate: "Due", size: "Size", date: "Date", type: "Type", sha: "SHA", email: "Email", progress: "Progress", detail: "Details" };
  const table = (values: unknown[], label: string): PluginBlock => {
    const rows = values.slice(0, 100).map(normalize);
    const custom = [...new Map([...(label === "Items" ? list(row(resource.fields).nodes).filter(v => ["TEXT", "NUMBER", "DATE", "SINGLE_SELECT", "ITERATION"].includes(String(row(v).dataType))).map(v => [String(row(v).id), name(v)] as const) : []), ...rows.flatMap(r => list(row(r.fieldValues).nodes).map(v => { const f = row(row(v).field); return [String(f.id ?? f.name), name(f)] as const; }))]).entries()].slice(0, 20);
    const columns = Object.keys(columnLabel).filter(key => key === "title" || rows.some(r => present(r[key]) && r[key] !== r.title));
    const cell = (r: Row, key: string): PluginInline[] => {
      const value = r[key]; if (!present(value)) return ["—"];
      if (key === "title") return [...(r.identifier && r.identifier !== value ? [copy(r.identifier)] : []), link(r, value)];
      if (key === "state") return [pill(value)];
      if (key === "assignee") return [person(value)];
      if (["dueDate", "date"].includes(key)) return [text(date(value), 60)];
      if (key === "size") return [`${Math.ceil(Number(value) / 1024)} KB`];
      if (["sha", "email"].includes(key)) return [copy(value)];
      if (key === "progress") return [`${Math.round(Number(value) * 100)}%`];
      return [text(value, 500)];
    };
    return { type: "table", headers: [...columns.map(key => columnLabel[key]), ...custom.map(([, name]) => text(name, 100))], rows: rows.map(r => ({
      cells: [...columns.map(key => ({ items: cell(r, key) })), ...custom.map(([id]) => {
        const f = list(row(r.fieldValues).nodes).map(row).find(f => String(row(f.field).id ?? row(f.field).name) === id) ?? {};
        return { items: [text(f.name ?? f.text ?? f.number ?? f.date ?? f.title ?? "—", 500)], edit: { action: `item.field/${r.id}/${id}`, field: "value" } };
      })], ...(label === "Items" ? { actions: [`item.archive/${r.id}`, `item.delete/${r.id}`] } : {}),
    })) };
  };
  const preview = (value: unknown): PluginBlock => {
    const r = normalize(value), blocks: PluginBlock[] = [{ type: "context", items: [link(r, r.title), ...(r.state ? [pill(r.state)] : []), ...(typeof r.additions === "number" ? [{ text: `+${r.additions}`, tone: "success" as const }, { text: `−${r.deletions ?? 0}`, tone: "danger" as const }] : [])] }];
    if (r.body || r.description || r.text) blocks.push({ type: "text", text: rich(r.body ?? r.description ?? r.text), markdown: true });
    if (typeof r.content === "string") blocks.push({ type: "code", text: text(r.content) });
    if (typeof r.patch === "string") blocks.push({ type: "code", text: text(r.patch), diff: true });
    if (list(r.assets).length) blocks.push(table(list(r.assets), "Assets"));
    return { type: "section", title: text(r.title, 350), collapsed: true, blocks };
  };
  const items = (data: unknown, label: string, depth = 0): PluginBlock[] => {
    if (depth > 2) return [{ type: "text", text: "Open the source URL for nested details." }];
    if (typeof data === "string") return [{ type: "text", text: rich(data), markdown: true }];
    if (Array.isArray(data)) {
      if (!data.length) return [{ type: "text", text: "—" }];
      if (["Comments", "Thread", "Messages", "Reviews", "Review comments", "Project updates", "Initiative updates"].includes(label)) return data.slice(0, 100).flatMap(v => message(row(v), label));
      if (label === "Items") return [table(data, label)];
      if (["Changed files / diff", "Files", "releases", "Releases", "Attachments", "Pins", "Blocks", "Attachments / blocks"].includes(label) || data.some(v => typeof row(v).patch === "string" || typeof row(v).content === "string" || typeof row(v).body === "string")) return data.slice(0, 100).map(preview);
      return [table(data, label)];
    }
    const r = row(data), scalars: Record<string, string> = { state: "Status", name: "Name", title: "Title", text: "Text", body: "Body", description: "Description", topic: "Topic", purpose: "Purpose", email: "Email", display_name: "Name", real_name: "Name", timezone: "Timezone", tz_label: "Timezone", status_text: "Status", num_members: "Members", total_count: "Total" };
    return [{ type: "fields", items: Object.entries(r).filter(([key, value]) => scalars[key] && present(value)).map(([key, value]) => ({ label: scalars[key], items: [text(typeof value === "object" ? row(value).value ?? name(value) : value)] })) },
      ...Object.entries(r).filter(([, v]) => Array.isArray(v) || Array.isArray(row(v).nodes)).flatMap(([key, value]) => items(Array.isArray(value) ? value : row(value).nodes, key, depth + 1))];
  };
  const main: PluginBlock[] = [{ type: "heading", text: title, edit: edit(titleField) }];
  if (!linear && fields.length) main.push({ type: "fields", items: fields });
  if (isPull && row(resource.head).ref && row(resource.base).ref) main.push({ type: "context", items: [copy(row(resource.head).ref), "→", copy(row(resource.base).ref)] });
  if (typeof resource.progress === "number" && Number.isFinite(resource.progress)) main.push({ type: "progress", label: "Progress", value: Math.max(0, Math.min(100, Math.round(resource.progress * 100))) });
  if (input.kind === "message") {
    main.push(...message({ ...resource, author: meta.Author, reactions: row(find("Reactions")).reactions ?? resource.reactions }, "", true));
    main.push({ type: "actions", ids: ["reaction.add"] });
  } else main.push(input.kind === "blob" ? { type: "code", text: text(input.body ?? ""), edit: { action: "file.update" } } : { type: "text", text: rich(input.body ?? resource.content ?? resource.description ?? ""), markdown: true, edit: edit(bodyField) });
  const checks = list(find("Checks")), decisions = new Map<string, Row>(), files = list(find("Changed files / diff"));
  for (const value of list(find("Reviews"))) { const review = row(value); if (["APPROVED", "CHANGES_REQUESTED", "DISMISSED"].includes(String(review.state))) decisions.set(String(row(review.user).id ?? row(review.user).login ?? review.id), review); }
  const metrics: PluginInline[] = [];
  if (checks.length) metrics.push(`${checks.filter(v => row(v).conclusion === "success").length}/${checks.length} checks passed`);
  if (decisions.size) metrics.push(`Reviews: ${[...decisions.values()].filter(v => v.state === "APPROVED").length}/${decisions.size} approved`);
  if (files.length) metrics.push({ text: `+${files.reduce<number>((n, v) => n + Number(row(v).additions ?? 0), 0)}`, tone: "success" }, { text: `−${files.reduce<number>((n, v) => n + Number(row(v).deletions ?? 0), 0)}`, tone: "danger" });
  if (metrics.length) main.push({ type: "context", items: metrics });
  for (const section of sections) {
    if (["Details", "Labels"].includes(section.title) || (input.kind === "message" && ["Author", "Channel", "Reactions"].includes(section.title))) continue;
    const data = section.title === "Thread" ? list(section.data).filter(v => row(v).ts !== resource.ts) : section.data;
    const blocks = section.title === "Reactions" ? [{ type: "context" as const, items: (reactions(Array.isArray(data) ? data : row(data).reactions) ?? []).map(r => `${r.label} ${r.count}`) }] : items(data, section.title);
    const create = section.title === "Comments" ? "comment.create" : section.title === "Thread" ? "reply.create" : section.title === "Messages" ? "message.create" : section.title === "Reviews" ? "review.create" : undefined;
    if (create) blocks.push({ type: "actions", ids: [create], composer: true });
    main.push({ type: "section", title: `${text(section.title, 100)}${Array.isArray(data) ? ` (${data.length})` : ""}`, blocks,
      collapsed: !["Sub-issues", "Issues", "Projects", "Items", "Directory", "Jobs", "Steps", "Comments", "Thread", "Messages", "Reviews", "Changed files / diff", "Checks", "Files", "README"].includes(section.title) && sections.length >= 3,
      ...(section.note ? { note: text(section.note, 2000) } : {}) });
  }
  const compose = input.kind === "message" ? "reply.create" : input.kind === "channel" ? "message.create" : "comment.create";
  const composeSection = input.kind === "message" ? "Thread" : input.kind === "channel" ? "Messages" : "Comments";
  if (!sections.some(s => s.title === composeSection)) main.push({ type: "actions", ids: [compose], composer: true });
  if (resource.answer) main.push({ type: "section", title: "Answer", blocks: message(row(resource.answer)) });
  for (const key of ["fields", "views"]) if (list(row(resource[key]).nodes).length) main.push({ type: "section", title: key === "fields" ? "Fields" : "Views", collapsed: true, blocks: [table(list(row(resource[key]).nodes), key)] });
  const timestamps = Object.entries(meta).filter(([key, value]) => ["Created", "Updated", "Timestamp", "Edited"].includes(key) && present(value)).map(([key, value]) => `${key} ${date(value)}`);
  if (timestamps.length) main.push({ type: "context", items: timestamps });
  if (truncated) main.push({ type: "text", text: "Preview shortened. Open the source URL for the full content." });
  const header = { title: input.service, context: text(input.context || name(resource.project), 200), reference: issueId || (number ? `#${number}` : undefined), icon: brandIcons[input.service] };
  return { format: "blocks", header, blocks: linear && fields.length ? [{ type: "columns", main, aside: [{ type: "fields", items: fields }] }] : main,
    collapsed: { format: "blocks", blocks: [{ type: "context", items: [{ text: title, strong: true }, badge] }] } };
}
