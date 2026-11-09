import type { OAuthOptions } from "./common.js";
// shortcut: GitHub and Slack ship with placeholder IDs; replace them when the publisher registers those OAuth apps.
import registered from "./oauth-clients.json" with { type: "json" };

type Service = "LINEAR" | "GITHUB" | "SLACK";

export function validateClientIds(value: unknown): Partial<Record<Service, string>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected public OAuth client IDs");
  for (const [name, id] of Object.entries(value)) {
    if (!["LINEAR", "GITHUB", "SLACK"].includes(name) || typeof id !== "string" || !/^[A-Za-z0-9._-]{1,256}$/.test(id))
      throw new Error("OAuth configuration accepts only LINEAR, GITHUB and SLACK public client IDs, never secrets");
  }
  return value;
}

export const clientIds = validateClientIds(registered);

export function oauthOptions(name: Service): OAuthOptions {
  const clientId = clientIds[name];
  if (!clientId) throw new Error(`This ${name} plugin has no registered OAuth application. Ask its publisher for a configured package.`);
  return { clientId };
}
