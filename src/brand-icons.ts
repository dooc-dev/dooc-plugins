import { readFileSync } from "node:fs";
import type { PluginIcon } from "@dooc-dev/dooc-plugin";

// Keep the official SVG originals in assets; the viewer loads them as inert images.
const image = (file: string): string => `data:image/svg+xml;base64,${readFileSync(new URL(`../../assets/brands/${file}`, import.meta.url)).toString("base64")}`;
export const brandIcons: Record<string, PluginIcon> = {
  Linear: { light: image("linear-light.svg"), dark: image("linear-dark.svg") },
  GitHub: { light: image("github-light.svg"), dark: image("github-dark.svg") },
  Slack: { light: image("slack.svg") },
};
