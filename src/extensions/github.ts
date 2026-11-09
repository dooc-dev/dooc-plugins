import { createGitHubPlugin } from "../github.js";
import { oauthOptions } from "../config.js";
export default { plugins: [createGitHubPlugin(oauthOptions("GITHUB"))] };
