import { createGitHubPlugin, createLinearPlugin, createSlackPlugin } from "../src/index.js";
import { createMockPlugin } from "./mock.js";
import { githubFixture, linearFixture, slackFixture } from "./fixtures.js";

const entries = ([
  [createLinearPlugin, linearFixture],
  [createGitHubPlugin, githubFixture],
  [createSlackPlugin, slackFixture],
] as const).map(([factory, fixture]) => createMockPlugin(factory({ clientId: "dooc-dev" }), fixture));

export default {
  plugins: entries.map(entry => entry.plugin),
  mocks: Object.fromEntries(entries.map(entry => [entry.plugin.id, entry.mock])),
};
