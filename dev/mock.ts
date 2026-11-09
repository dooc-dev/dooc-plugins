import type { ActionContext, ActionPlugin } from "../src/actions.js";
import type { PluginContext } from "@dooc-dev/dooc-plugin";
import { createHash, randomBytes } from "node:crypto";
import { PluginError } from "@dooc-dev/dooc-plugin";

/** Route a real plugin through dooc's local mock transport, including OAuth and PKCE. */
export function createMockPlugin(original: ActionPlugin, fixture: () => Omit<ActionContext, "user">) {
  const origin = `https://${original.id}.dooc.invalid`;
  const codes = new Map<string, { callback: string; challenge: string; expires: number }>();
  const access = new Map<string, { expires: number; data: Omit<ActionContext, "user"> }>(), refresh = new Map<string, { expires: number; data: Omit<ActionContext, "user"> }>();
  const nonce = () => randomBytes(32).toString("base64url");
  const error = (message: string, status = 400) => Response.json({ error: message }, { status });
  const oauth = { ...original.oauth, clientId: `dooc-dev-${original.id}`, clientSecret: undefined,
    authorizationUrl: `${origin}/authorize`, tokenUrl: `${origin}/token` };
  const contextFor = <T extends PluginContext>(context: T): T => ({
    ...context,
    request(source: string, init?: Parameters<ActionContext["request"]>[1]) {
      const url = new URL(source);
      if (!original.apiOrigins.includes(url.origin)) throw new PluginError(400, "Unexpected demo API origin");
      return (context.request as ActionContext["request"])(`${origin}${url.pathname}${url.search}`, init);
    },
  });
  const tokens = (data = fixture()) => {
    const token = { access_token: `demo-${nonce()}`, refresh_token: `demo-refresh-${nonce()}`,
      expires_in: 3600, token_type: original.id === "slack" ? "user" : "Bearer" };
    access.set(token.access_token, { expires: Date.now() + 3600_000, data });
    refresh.set(token.refresh_token, { expires: Date.now() + 8 * 3600_000, data });
    return Response.json(original.id === "slack" ? { ok: true, authed_user: token } : token);
  };
  const plugin: ActionPlugin = {
    ...original, oauth, apiOrigins: [origin],
    identifyUser: context => original.identifyUser(contextFor(context)),
    read: (url, context) => original.read(url, contextFor(context)),
    actions: (url, context) => original.actions(url, contextFor(context)),
    act: (url, context, input) => original.act(url, contextFor(context), input),
  };
  const mock = {
    origin, autoConnect: true,
    async handle(request: Request) {
      for (const entries of [codes, access, refresh]) {
        for (const [key, value] of entries) if (value.expires <= Date.now()) entries.delete(key);
        if (entries.size >= 128) return error("Demo session limit reached", 429);
      }
      const url = new URL(request.url), params = url.searchParams;
      if (url.origin !== origin) return error("Unknown demo origin", 404);
      if (url.pathname === "/authorize" && request.method === "GET") {
        let callback;
        try { callback = new URL(params.get("redirect_uri") ?? ""); } catch { return error("Invalid callback"); }
        if (params.get("client_id") !== oauth.clientId || params.get("response_type") !== "code" ||
          params.get(oauth.scopeParameter ?? "scope") !== oauth.scopes.join(oauth.scopeSeparator ?? " ") ||
          params.get("code_challenge_method") !== "S256" || !/^[\w-]{43}$/.test(params.get("code_challenge") ?? "") ||
          !/^[\w-]{43}$/.test(params.get("state") ?? "") || callback.protocol !== "http:" ||
          !["localhost", "127.0.0.1", "[::1]"].includes(callback.hostname) || callback.username || callback.password || callback.search || callback.hash ||
          callback.pathname !== `/api/plugins/callback/${original.id}`) return error("Invalid demo authorization");
        const code = nonce();
        codes.set(code, { callback: callback.href, challenge: params.get("code_challenge")!, expires: Date.now() + 60_000 });
        callback.searchParams.set("code", code); callback.searchParams.set("state", params.get("state")!);
        return new Response(null, { status: 303, headers: { location: callback.href } });
      }
      if (url.pathname === "/token" && request.method === "POST") {
        const form = new URLSearchParams(await request.text());
        if (form.get("client_id") !== oauth.clientId) return error("invalid_client");
        if (form.get("grant_type") === "refresh_token") {
          const grant = refresh.get((form.get("refresh_token") ?? ""));
          refresh.delete((form.get("refresh_token") ?? ""));
          return grant ? tokens(grant.data) : error("invalid_grant");
        }
        const grant = codes.get((form.get("code") ?? "")); codes.delete((form.get("code") ?? ""));
        const verifier = form.get("code_verifier") ?? "";
        if (form.get("grant_type") !== "authorization_code" || !grant || form.get("redirect_uri") !== grant.callback ||
          !/^[\w.~-]{43,128}$/.test(verifier) || createHash("sha256").update(verifier).digest("base64url") !== grant.challenge)
          return error("invalid_grant");
        return tokens();
      }
      const token = /^Bearer (.+)$/.exec(request.headers.get("authorization") ?? "")?.[1];
      if (!access.has(token ?? "")) return error("invalid_token", 401);
      if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(request.method)) return error("Unsupported method", 405);
      try {
        const source = `${original.apiOrigins[0]}${url.pathname}${url.search}`;
        const result = await access.get(token ?? "")!.data.request(source, { method: request.method as "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
          ...(request.body ? { body: await request.json() } : {}) });
        return result === null ? new Response(null, { status: 204 }) : Response.json(result);
      } catch (cause) {
        return error("This resource has no demo fixture", cause instanceof PluginError ? cause.status : 404);
      }
    },
  };
  return { plugin, mock };
}
