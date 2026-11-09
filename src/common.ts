import { PluginError, type PluginContext } from "@dooc-dev/dooc-plugin";

export interface OAuthOptions { clientId: string; clientSecret?: string }
export type Row = Record<string, unknown>;
export interface Section { title: string; data: unknown; note?: string }

export function object(value: unknown): Row {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new PluginError(502, "Invalid service response");
  return value as Row;
}
export function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new PluginError(502, "Invalid service collection");
  return value;
}
export function string(value: unknown): string {
  if (typeof value !== "string" || !value) throw new PluginError(502, "Missing service field");
  return value;
}
export const label = (value: unknown): string => typeof value === "string" ? value : "";
export const segment = encodeURIComponent;

export function pathParts(url: URL): string[] | undefined {
  if (url.protocol !== "https:" || url.username || url.password || url.port) return;
  try {
    const parts = url.pathname.replace(/\/$/, "").split("/").slice(1).map(decodeURIComponent);
    if (parts.some(part => !part || /[\x00-\x1f\x7f\\]/.test(part) || part === "." || part === "..")) return;
    return parts;
  } catch { return; }
}

export async function graphql(context: PluginContext, endpoint: string, query: string, variables: Row = {}): Promise<Row> {
  const result = object(await context.request(endpoint, { method: "POST", body: { query, variables } }));
  if (result.errors !== undefined) {
    const errors = array(result.errors);
    if (errors.length) {
      const codes = errors.map(error => {
        const e = object(error);
        return e.extensions && typeof e.extensions === "object" ? (e.extensions as Row).code : e.type;
      });
      if (codes.some(code => ["UNAUTHENTICATED", "AUTHENTICATION_ERROR"].includes(String(code))))
        throw new PluginError(401, "Connect this plugin again");
      if (codes.some(code => ["FORBIDDEN", "FORBIDDEN_ERROR"].includes(String(code))))
        throw new PluginError(403, "Access denied by the service");
      throw new PluginError(502, "Service GraphQL request failed");
    }
  }
  return object(result.data);
}

export async function optionalSections(tasks: Record<string, () => Promise<unknown>>): Promise<Section[]> {
  return Promise.all(Object.entries(tasks).map(async ([title, task]) => {
    try { return { title, data: await task() }; }
    catch (error) {
      if (!(error instanceof Error) || error.name !== "DoocPluginError") throw error;
      const status = (error as PluginError).status;
      if (status === 401) throw error;
      return { title, data: null, note: `Unavailable (${status}). Check service access or retry later.` };
    }
  }));
}

export const PAGE_SIZE = 30;
// shortcut: previews fetch at most three pages per collection; add host pagination when the SDK exposes interactive reads.
export const MAX_PAGES = 3;
export const MORE = "Preview limit reached. Open the source URL for the remaining items.";

export function partialPage(error: unknown, data: unknown[], title: string): Section {
  if (!data.length || !(error instanceof Error) || error.name !== "DoocPluginError" || (error as PluginError).status === 401) throw error;
  return { title, data, note: `Only part of this collection could be loaded (${(error as PluginError).status}). Open the source URL or retry later.` };
}

export function connection(value: unknown): { nodes: unknown[]; cursor?: string } {
  const data = object(value), page = object(data.pageInfo);
  if (typeof page.hasNextPage !== "boolean") throw new PluginError(502, "Invalid service pagination");
  return { nodes: array(data.nodes), cursor: page.hasNextPage ? string(page.endCursor) : undefined };
}

export { view } from "./cards.js";
