import { createGitHubPlugin, createLinearPlugin, createSlackPlugin } from "./index.js";
import type { DataPlugin } from "@dooc-dev/dooc-plugin";
import { clientIds, oauthOptions } from "./config.js";

const plugins: DataPlugin[] = [];
for (const [name, factory] of [["LINEAR", createLinearPlugin], ["GITHUB", createGitHubPlugin], ["SLACK", createSlackPlugin]] as const) {
  if (!clientIds[name]) continue;
  plugins.push(factory(oauthOptions(name)));
}
if (!plugins.length) throw new Error("No OAuth applications are registered. Ask the publisher for configured plugins.");
export default { plugins };
