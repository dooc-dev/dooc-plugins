import { createLinearPlugin } from "../linear.js";
import { oauthOptions } from "../config.js";
export default { plugins: [createLinearPlugin(oauthOptions("LINEAR"))] };
