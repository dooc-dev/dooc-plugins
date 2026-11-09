import { createSlackPlugin } from "../slack.js";
import { oauthOptions } from "../config.js";
export default { plugins: [createSlackPlugin(oauthOptions("SLACK"))] };
