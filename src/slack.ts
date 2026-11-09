import { withActions, bodyField, version, type ActionContext, type ActionPlugin, type BoundAction } from "./actions.js";
import { parseOAuthToken, PluginError, type PluginContext, type OAuthToken } from "@dooc-dev/dooc-plugin";
import { brandIcons } from "./brand-icons.js";
import { array, label, MAX_PAGES, MORE, object, optionalSections, partialPage, pathParts, string, view, type OAuthOptions, type Row, type Section } from "./common.js";

const API = "https://slack.com/api/";
const channelId = /^[CGD][A-Z\d]+$/;
const userId = /^[UW][A-Z\d]+$/;
const teamId = /^T[A-Z\d]+$/;
const fileId = /^F[A-Z\d]+$/;
const timestamp = /^\d{10,}\.\d{6}$/;
type Route = { kind: string; id?: string; channel?: string; ts?: string; thread?: string; team?: string; query?: string };

function message(channel: string, stamp: string, url: URL): Route | undefined {
  const ts = /^p\d{16,}$/.test(stamp) ? `${stamp.slice(1, -6)}.${stamp.slice(-6)}` : stamp;
  const thread = url.searchParams.get("thread_ts") ?? undefined;
  if (!timestamp.test(ts) || (thread && !timestamp.test(thread))) return;
  return { kind: "message", channel, ts, thread };
}

function parse(url: URL): Route | undefined {
  if (!/^[a-z\d][a-z\d-]*\.slack\.com$/.test(url.hostname)) return;
  const p = pathParts(url);
  if (!p) return;
  if (url.hostname === "files.slack.com") {
    const match = p[1]?.match(/^(T[A-Z\d]+)-(F[A-Z\d]+)$/);
    if (p[0] === "files-pri" && match && p.length >= 3) return { kind: "file", team: match[1], id: match[2] };
    return;
  }
  if (p[0] === "archives" && channelId.test(p[1] ?? "")) {
    if (p.length === 2) return { kind: "channel", channel: p[1] };
    if (p.length === 3) return message(p[1], p[2], url);
  }
  if (p[0] === "team" && userId.test(p[1] ?? "") && p.length === 2) return { kind: "user", id: p[1] };
  if (p[0] === "files" && userId.test(p[1] ?? "") && fileId.test(p[2] ?? "") && p.length >= 3 && p.length <= 4) return { kind: "file", id: p[2] };
  if (["docs", "canvas"].includes(p[0]) && teamId.test(p[1] ?? "") && fileId.test(p[2] ?? "") && p.length === 3) return { kind: "canvas", team: p[1], id: p[2] };
  if (p[0] === "search" && p.length === 1 && url.searchParams.get("q")) return { kind: "search", query: url.searchParams.get("q")! };
  if (url.hostname === "app.slack.com" && p[0] === "client" && teamId.test(p[1] ?? "")) {
    const team = p[1];
    if (p.length === 2) return { kind: "workspace", team };
    if (p[2] === "search" && p.length === 3 && url.searchParams.get("q")) return { kind: "search", team, query: url.searchParams.get("q")! };
    if (channelId.test(p[2] ?? "")) {
      if (p.length === 3) return { kind: "channel", channel: p[2], team };
      if (p.length === 4) { const result = message(p[2], p[3], url); if (result) return { ...result, team }; }
      if (p.length === 5 && p[3] === "thread") {
        const stamp = p[4].startsWith(`${p[2]}-`) ? p[4].slice(p[2].length + 1) : p[4];
        const result = message(p[2], stamp, url); if (result) return { ...result, team };
      }
    }
  }
}

function check(input: unknown): Row {
  const result = object(input);
  if (result.ok === true) return result;
  const error = result.error;
  if (["invalid_auth", "not_authed", "token_revoked", "token_expired", "account_inactive"].includes(String(error)))
    throw new PluginError(401, "Connect Slack again");
  if (["missing_scope", "not_allowed_token_type", "not_in_channel", "no_permission", "access_denied", "cant_update_message", "cant_delete_message", "edit_window_closed", "restricted_action"].includes(String(error)))
    throw new PluginError(403, "Slack access or a required scope is missing");
  if (["already_reacted", "no_reaction"].includes(String(error))) throw new PluginError(409, "リアクションの状態が変わりました。再読み込みしてください");
  if (["channel_not_found", "thread_not_found", "message_not_found", "file_not_found", "user_not_found"].includes(String(error)))
    throw new PluginError(404, "Slack resource not found or inaccessible");
  if (error === "ratelimited") throw new PluginError(429, "Slack rate limit reached; retry later");
  throw new PluginError(502, "Slack API request failed");
}

function parseToken(input: unknown): OAuthToken {
  const result = check(input);
  const user = object(result.authed_user ?? result);
  if (user.token_type !== "user" || typeof user.access_token !== "string" || /^xox[ba]-/.test(user.access_token))
    throw new PluginError(403, "A Slack user token is required");
  return parseOAuthToken(user);
}

async function call(context: PluginContext, method: string, parameters: Record<string, string> = {}): Promise<Row> {
  if (method === "auth.test" || method === "bookmarks.list")
    return check(await context.request(API + method, { method: "POST", body: parameters }));
  const url = new URL(API + method);
  for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value);
  return check(await context.request(url.href));
}

async function collection(context: PluginContext, method: string, key: string, params: Record<string, string> = {}): Promise<Section> {
  const data: unknown[] = []; let cursor = "";
  // shortcut: history/replies use one 15-item page to respect restrictive Slack app tiers; open Slack for older messages.
  const pages = ["conversations.history", "conversations.replies"].includes(method) ? 1 : MAX_PAGES;
  for (let page = 0; page < pages; page++) {
    let result: Row;
    try { result = await call(context, method, { ...params, limit: pages === 1 ? "15" : "30", ...(cursor ? { cursor } : {}) }); }
    catch (error) { return partialPage(error, data, key); }
    data.push(...array(result[key]));
    const next = result.response_metadata ? label(object(result.response_metadata).next_cursor) : "";
    if (!next && !result.has_more) return { title: key, data };
    if (!next) return { title: key, data, note: MORE };
    if (next === cursor) throw new PluginError(502, "Slack pagination did not advance");
    cursor = next;
  }
  return { title: key, data, note: MORE };
}

async function messageData(route: Route, context: PluginContext) {
  const channel = route.channel!;
  const ts = route.ts!, root = route.thread ?? ts;
  let result: Row;
  try {
    result = await call(context, "conversations.replies", { channel, ts: root, limit: "15" });
  } catch (error) {
    if (!(error instanceof Error) || error.name !== "DoocPluginError" || (error as PluginError).status !== 404 || route.thread) throw error;
    result = await call(context, "conversations.history", { channel, oldest: ts, latest: ts, inclusive: "true", limit: "1" });
  }
  const messages = array(result.messages);
  let selected = messages.find(item => object(item).ts === ts);
  if (!selected && (result.has_more || (result.response_metadata && object(result.response_metadata).next_cursor))) {
    const focused = await call(context, "conversations.replies", { channel, ts: root, oldest: ts, latest: ts, inclusive: "true", limit: "1" });
    selected = array(focused.messages).find(item => object(item).ts === ts);
  }
  if (!selected) throw new PluginError(404, "The linked Slack message is not available");
  return { data: object(selected), messages, result };
}

async function slackActions(url: URL, context: ActionContext): Promise<BoundAction[]> {
  const route = parse(url);
  if (!route || !["message", "channel"].includes(route.kind)) return [];
  const identity = context.user.id.split(":");
  if (identity.length !== 4 || identity[0] !== "slack" ||
    (url.hostname !== "app.slack.com" && url.hostname !== identity[2]) || (route.team && route.team !== identity[1]))
    throw new PluginError(403, "Connect Slack with the workspace in this URL");
  const channel = route.channel!;
  const info = object((await call(context, "conversations.info", { channel })).channel);
  const target = `#${label(info.name) || channel}`;
  const write = async (method: string, body: Row, message: string, deleted = false) => {
    check(await context.request(API + method, { method: "POST", body: { ...body, channel } }));
    return { message, ...(deleted ? { deleted } : {}) };
  };
  if (info.is_archived === true) return [];
  if (route.kind === "channel") return [{
    id: "message.create", label: "このチャンネルに投稿", target, fields: [bodyField()],
    run: values => write("chat.postMessage", { text: values.body, unfurl_links: false, unfurl_media: false }, "メッセージを投稿しました"),
  }];
  const { data, messages } = await messageData(route, context);
  const ts = route.ts!, root = label(data.thread_ts) || ts;
  const messageTarget = `${target} · ${label(data.text).slice(0, 100)}`;
  const actions: BoundAction[] = [{
    id: "reply.create", label: "このスレッドに返信", target: messageTarget, fields: [bodyField()],
    run: values => write("chat.postMessage", { text: values.body, thread_ts: root, reply_broadcast: false, unfurl_links: false, unfurl_media: false }, "返信を投稿しました"),
  }];
  for (const mode of ["add", "remove"]) actions.push({
    id: `reaction.${mode}`, label: mode === "add" ? "リアクションを追加" : "自分のリアクションを外す", target: messageTarget,
    fields: [{ name: "emoji", label: "絵文字名（例：eyes、+1）", type: "text", required: true, value: "+1", maxLength: 80 }],
    async run(values) {
      if (!/^[a-z\d_+\-]+$/.test(values.emoji)) throw new PluginError(400, "絵文字名を確認してください");
      return write(`reactions.${mode}`, { timestamp: ts, name: values.emoji }, mode === "add" ? "リアクションを追加しました" : "リアクションを外しました");
    },
  });
  const candidates = new Map([...messages, data].map(value => [object(value).ts, object(value)]));
  for (const entry of candidates.values()) {
    if (entry.user !== identity[3] || (entry.ts !== ts && entry.thread_ts !== root)) continue;
    const messageTs = string(entry.ts), text = label(entry.text), revision = version(entry.edited, text);
    const ownTarget = `${target} の自分のメッセージ: ${text.slice(0, 100)}`;
    actions.push({
      id: `message.update/${messageTs}`, label: `自分の投稿を編集 · ${text.slice(0, 35)}`, target: ownTarget, version: revision, fields: [bodyField(text)],
      run: values => write("chat.update", { ts: messageTs, text: values.body }, "メッセージを更新しました"),
    }, {
      id: `message.delete/${messageTs}`, label: `自分の投稿を削除 · ${text.slice(0, 35)}`, target: ownTarget, version: revision, destructive: true, fields: [],
      run: () => write("chat.delete", { ts: messageTs }, "メッセージを削除しました", messageTs === ts),
    });
  }
  return actions;
}

export function createSlackPlugin({ clientId }: Pick<OAuthOptions, "clientId">): ActionPlugin {
  return withActions({
    id: "slack", name: "Slack", icon: brandIcons.Slack, matches: url => Boolean(parse(url)), apiOrigins: ["https://slack.com"],
    oauth: {
      authorizationUrl: "https://slack.com/oauth/v2/authorize", tokenUrl: `${API}oauth.v2.access`, clientId,
      scopeParameter: "user_scope", scopeSeparator: ",", parseToken,
      scopes: ["channels:read", "channels:history", "groups:read", "groups:history", "im:read", "im:history", "mpim:read", "mpim:history", "users:read", "files:read", "reactions:read", "pins:read", "bookmarks:read", "search:read", "team:read", "chat:write", "reactions:write"],
    },
    async identifyUser(context) {
      const auth = await call(context, "auth.test");
      if (auth.bot_id || !userId.test(label(auth.user_id)) || !teamId.test(label(auth.team_id))) throw new PluginError(403, "A Slack user account is required");
      const user = object((await call(context, "users.info", { user: string(auth.user_id) })).user);
      if (user.is_bot !== false || user.is_app_user === true || user.deleted === true) throw new PluginError(403, "An active Slack user account is required");
      const workspace = new URL(string(auth.url));
      if (workspace.protocol !== "https:" || !/^[a-z\d][a-z\d-]*\.slack\.com$/.test(workspace.hostname)) throw new PluginError(502, "Invalid Slack workspace URL");
      return { id: `slack:${auth.team_id}:${workspace.hostname}:${auth.user_id}`, name: label(user.real_name) || string(user.name) };
    },
    async read(url, context) {
      const route = parse(url);
      if (!route) throw new PluginError(400, "Unsupported Slack URL");
      const identity = context.user.id.split(":");
      const hostMatches = ["app.slack.com", "files.slack.com"].includes(url.hostname) || url.hostname === identity[2];
      if (identity.length !== 4 || identity[0] !== "slack" || !hostMatches || (route.team && route.team !== identity[1]))
        throw new PluginError(403, "Connect Slack with the workspace in this URL");
      let title = "Slack", body = "", data: Row = {}, metadata: Row = {}, sections: Section[] = [];
      const channel = route.channel!;
      if (route.kind === "message") {
        const ts = route.ts!, loaded = await messageData(route, context);
        const { messages, result } = loaded;
        data = loaded.data; title = "Message"; body = label(data.text);
        metadata = { Channel: channel, Author: data.user ?? data.bot_id, Timestamp: ts, Replies: data.reply_count, Edited: data.edited ? object(data.edited).ts : undefined };
        const tasks: Record<string, () => Promise<unknown>> = {
          Channel: async () => (await call(context, "conversations.info", { channel })).channel,
          Reactions: async () => (await call(context, "reactions.get", { channel, timestamp: ts, full: "true" })).message,
        };
        if (typeof data.user === "string" && userId.test(data.user)) tasks.Author = async () => (await call(context, "users.info", { user: String(data.user) })).user;
        sections = await optionalSections(tasks);
        const channelInfo = sections.find(section => section.title === "Channel")?.data;
        if (channelInfo && label(object(channelInfo).name)) title = `Message · #${object(channelInfo).name}`;
        const author = sections.find(section => section.title === "Author")?.data;
        if (author) metadata.Author = label(object(author).real_name) || metadata.Author;
        if (data.thread_ts || Number(data.reply_count) > 0 || route.thread) sections.push({ title: "Thread", data: messages, note: result.has_more || (result.response_metadata && object(result.response_metadata).next_cursor) ? MORE : undefined });
        if (data.files) sections.push({ title: "Files", data: array(data.files) });
        if (data.attachments) sections.push({ title: "Attachments", data: array(data.attachments) });
        if (data.blocks) sections.push({ title: "Blocks", data: array(data.blocks) });
      } else if (route.kind === "channel") {
        data = object((await call(context, "conversations.info", { channel, include_num_members: "true" })).channel);
        title = label(data.name) ? `#${data.name}` : "Conversation";
        body = [data.topic ? label(object(data.topic).value) : "", data.purpose ? label(object(data.purpose).value) : ""].filter(Boolean).join("\n\n");
        metadata = { Members: data.num_members, Private: data.is_private, Archived: data.is_archived };
        sections = await optionalSections({
          Messages: () => collection(context, "conversations.history", "messages", { channel }),
          Members: () => collection(context, "conversations.members", "members", { channel }),
          Pins: async () => (await call(context, "pins.list", { channel })).items,
          Bookmarks: async () => (await call(context, "bookmarks.list", { channel_id: channel })).bookmarks,
        });
        sections = sections.map(section => ["Messages", "Members"].includes(section.title) && section.data !== null ? { ...object(section.data), title: section.title } as Section : section);
      } else if (route.kind === "file" || route.kind === "canvas") {
        const result = await call(context, "files.info", { file: route.id! });
        data = object(result.file); title = label(data.title) || label(data.name) || "File";
        body = label(data.preview) || label(data.preview_plain_text);
        metadata = { Type: data.mimetype, Size: data.size, Author: data.user, Created: data.created };
        sections.push({ title: "Content access", data: null, note: "Shows file metadata and the preview returned by files.info. Private downloads and full canvas contents require opening Slack." });
      } else if (route.kind === "user") {
        data = object((await call(context, "users.info", { user: route.id! })).user);
        const profile = object(data.profile);
        title = label(profile.display_name) || label(data.real_name) || string(data.name);
        body = label(profile.title); metadata = { Status: profile.status_text, Timezone: data.tz_label, Deleted: data.deleted };
      } else if (route.kind === "workspace") {
        data = object((await call(context, "team.info", { team: route.team! })).team); title = string(data.name);
        const channels = await collection(context, "conversations.list", "channels", { types: "public_channel,private_channel,mpim,im", exclude_archived: "true" });
        sections = [{ ...channels, title: "Conversations" }];
      } else if (route.kind === "search") {
        const messages: unknown[] = [], files: unknown[] = []; let more = false, note: string | undefined;
        for (let page = 1; page <= MAX_PAGES; page++) {
          let result: Row;
          try { result = await call(context, "search.all", { query: route.query!, count: "30", page: String(page), highlight: "false", sort: "timestamp", sort_dir: "desc" }); }
          catch (error) { note = partialPage(error, [...messages, ...files], "Search").note; break; }
          const messagePage = object(result.messages), filePage = object(result.files);
          const messagePages = Number(messagePage.paging ? object(messagePage.paging).pages : messagePage.pagination ? object(messagePage.pagination).page_count : 1);
          const filePages = Number(filePage.paging ? object(filePage.paging).pages : filePage.pagination ? object(filePage.pagination).page_count : 1);
          if (page <= messagePages) messages.push(...array(messagePage.matches));
          if (page <= filePages) files.push(...array(filePage.matches));
          more = messagePages > page || filePages > page;
          if (!more) break;
        }
        return view({ service: "Slack", title: `Search: ${route.query}`, sections: [{ title: "Messages", data: messages, note: note ?? (more ? MORE : undefined) }, { title: "Files", data: files, note: note ?? (more ? MORE : undefined) }] });
      }
      const conversations = sections.filter(section => ["Thread", "Messages", "Pins"].includes(section.title));
      const authors = new Map<string, string>();
      if (route.kind === "message" && typeof data.user === "string" && typeof metadata.Author === "string") authors.set(data.user, metadata.Author);
      const authorIds = new Set(conversations.flatMap(section => Array.isArray(section.data) ? section.data.map(value => {
        const message = object(value); return label(message.message ? object(message.message).user : message.user);
      }) : []).filter(id => userId.test(id) && !authors.has(id)));
      if (["file", "canvas"].includes(route.kind) && userId.test(label(metadata.Author))) authorIds.add(String(metadata.Author));
      // shortcut: resolve up to 15 participants per preview; keep IDs for larger threads until reads can be cached across cards.
      const people = await optionalSections(Object.fromEntries([...authorIds].slice(0, 15).map(id => [id, async () => (await call(context, "users.info", { user: id })).user])));
      for (const person of people) if (person.data) authors.set(person.title, label(object(person.data).real_name) || label(object(person.data).name));
      metadata.Author = authors.get(label(metadata.Author)) || metadata.Author;
      for (const section of conversations) if (Array.isArray(section.data)) section.data = section.data.map(value => {
        const entry = object(value), message = entry.message ? object(entry.message) : entry;
        const enriched = { ...message, author: authors.get(label(message.user)) };
        return entry.message ? { ...entry, message: enriched } : enriched;
      });
      sections.unshift({ title: "Details", data });
      return view({ service: "Slack", viewerId: identity[3], kind: route.kind, title, body, metadata, sections });
    },
  }, slackActions);
}
