import type { OAuthOptions } from "./common.js";

export function oauthOptions(name: "LINEAR" | "GITHUB" | "SLACK"): OAuthOptions {
  const clientId = process.env[`DOOC_${name}_CLIENT_ID`];
  const clientSecret = process.env[`DOOC_${name}_CLIENT_SECRET`];
  if (!clientId?.trim()) throw new Error(`Set DOOC_${name}_CLIENT_ID`);
  if (name === "GITHUB" && !clientSecret?.trim()) throw new Error("Set both DOOC_GITHUB_CLIENT_ID and DOOC_GITHUB_CLIENT_SECRET");
  return { clientId, ...(clientSecret ? { clientSecret } : {}) };
}
