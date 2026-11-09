import { createGitHubPlugin, createLinearPlugin, createSlackPlugin } from "./index.js";
import type { DataPlugin } from "@dooc-dev/dooc-plugin";
import { oauthOptions } from "./config.js";

const plugins: DataPlugin[] = [];
for (const [name, factory] of [["LINEAR", createLinearPlugin], ["GITHUB", createGitHubPlugin], ["SLACK", createSlackPlugin]] as const) {
  const clientId = process.env[`DOOC_${name}_CLIENT_ID`];
  const clientSecret = process.env[`DOOC_${name}_CLIENT_SECRET`];
  if (!clientId && !clientSecret) continue;
  plugins.push(factory(oauthOptions(name)));
}
if (!plugins.length) throw new Error("Configure at least one service using DOOC_<SERVICE>_CLIENT_ID (GitHub also requires CLIENT_SECRET)");
export default { plugins };
