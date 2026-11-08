import type { PluginView } from "@sasaki-s-sci/dooc-plugin";
export const { pluginViewHtml: render } = await import(new URL("./viewer/plugin-view.js", import.meta.resolve("@sasaki-s-sci/dooc")).href) as { pluginViewHtml: (view: PluginView) => string };
