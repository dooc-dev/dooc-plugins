import type { PluginView } from "@sasaki-s-sci/dooc-plugin";
const root = import.meta.resolve("@sasaki-s-sci/dooc");
const { validatePluginView } = await import(new URL("./plugins/view.js", root).href) as { validatePluginView: (view: unknown) => PluginView };
const { pluginViewHtml } = await import(new URL("./viewer/plugin-view.js", root).href) as { pluginViewHtml: (view: PluginView) => string };
export const render = (view: PluginView): string => pluginViewHtml(validatePluginView(view));
