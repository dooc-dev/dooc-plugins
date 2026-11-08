import { createGitHubPlugin, createLinearPlugin, createSlackPlugin } from "./index.js";
import type { DataPlugin } from "@sasaki-s-sci/dooc-plugin";

const plugins: DataPlugin[] = [];
for (const [name, factory] of [["LINEAR", createLinearPlugin], ["GITHUB", createGitHubPlugin], ["SLACK", createSlackPlugin]] as const) {
  const clientId = process.env[`DOOC_${name}_CLIENT_ID`];
  const clientSecret = process.env[`DOOC_${name}_CLIENT_SECRET`];
  if (!clientId && !clientSecret) continue;
  if (!clientId?.trim()) throw new Error(`Set DOOC_${name}_CLIENT_ID`);
  if (name === "GITHUB" && !clientSecret?.trim()) throw new Error("Set both DOOC_GITHUB_CLIENT_ID and DOOC_GITHUB_CLIENT_SECRET");
  plugins.push(factory({ clientId, ...(clientSecret ? { clientSecret } : {}) }));
}
if (!plugins.length) throw new Error("Configure at least one service using DOOC_<SERVICE>_CLIENT_ID (GitHub also requires CLIENT_SECRET)");
export default { plugins };
