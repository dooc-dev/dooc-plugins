import { createHash } from "node:crypto";
import { PluginError, type DataPlugin, type PluginContext, type PluginUser } from "@dooc-dev/dooc-plugin";
import type { CardView } from "./cards.js";

import type { PluginActionContext, PluginActionField, PluginAction, PluginActionRequest, PluginActionResult } from "@dooc-dev/dooc-plugin";
export type ActionContext = PluginActionContext;
export type ActionField = PluginActionField;
export type UrlAction = PluginAction;
export type ActionRequest = PluginActionRequest;
export type ActionResult = PluginActionResult;
export interface BoundAction extends UrlAction { run(values: Record<string, string>): Promise<ActionResult> }
export interface ActionPlugin extends DataPlugin {
  // shortcut: SDK 0.0.2 lacks the host's device field; remove this extension when the SDK exports it.
  oauth: DataPlugin["oauth"] & { deviceAuthorizationUrl?: string };
  read(url: URL, context: PluginContext & { user: PluginUser }): Promise<CardView>;
  actions(url: URL, context: PluginContext & { user: PluginUser }): Promise<UrlAction[]>;
  act(url: URL, context: ActionContext, request: ActionRequest): Promise<ActionResult>;
}

export const version = (...values: unknown[]): string => createHash("sha256").update(JSON.stringify(values)).digest("hex");
export const bodyField = (value = ""): ActionField => ({ name: "body", label: "本文", type: "textarea", required: true, value, maxLength: 4000 });
export const titleField = (value: string): ActionField => ({ name: "title", label: "タイトル", type: "text", required: true, value, maxLength: 200 });

function validate(action: BoundAction, input: ActionRequest): Record<string, string> {
  if ((action.destructive || action.confirm) && input.confirmed !== true) throw new PluginError(400, "操作対象を確認してください");
  if (action.version && input.version !== action.version) throw new PluginError(409, "表示後に内容が変わりました。再読み込みして確認してください");
  if (!input.values || typeof input.values !== "object" || Array.isArray(input.values)) throw new PluginError(400, "入力内容が不正です");
  if (Object.keys(input.values).some(key => !action.fields.some(field => field.name === key))) throw new PluginError(400, "この操作で指定できない項目です");
  if (action.partial && !Object.keys(input.values).length) throw new PluginError(400, "変更する項目を指定してください");
  const values: Record<string, string> = {};
  for (const field of action.fields) {
    if (action.partial && !Object.hasOwn(input.values, field.name)) continue;
    const value = input.values[field.name] ?? "";
    if (typeof value !== "string" || value.length > (field.maxLength ?? 4000) || (field.required && !value.trim()) ||
      (field.type === "select" && !field.options?.some(option => option.value === value)))
      throw new PluginError(400, `${field.label}を確認してください`);
    if (field.type === "multiselect") {
      let selected: unknown;
      try { selected = JSON.parse(value); } catch { throw new PluginError(400, `${field.label}を確認してください`); }
      if (!Array.isArray(selected) || (field.required && !selected.length) || new Set(selected).size !== selected.length || selected.some(item => typeof item !== "string" || !field.options?.some(option => option.value === item)))
        throw new PluginError(400, `${field.label}を確認してください`);
    }
    if (value && field.type === "date" && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value))
      throw new PluginError(400, `${field.label}を確認してください`);
    if (value && field.type === "number" && (!Number.isFinite(Number(value)) || Number(value) < (field.min ?? -Infinity) || Number(value) > (field.max ?? Infinity)))
      throw new PluginError(400, `${field.label}を確認してください`);
    values[field.name] = value;
  }
  return values;
}

/** Resolve every operation again from its URL and authenticated user before writing. */
export function withActions(plugin: Omit<ActionPlugin, "actions" | "act">, load: (url: URL, context: ActionContext) => Promise<BoundAction[]>): ActionPlugin {
  const check = (url: URL) => { if (!plugin.matches(url)) throw new PluginError(400, "Unsupported service URL"); };
  return {
    ...plugin,
    async actions(url, context) {
      check(url);
      return (await load(url, context)).map(({ run: _run, ...action }) => action);
    },
    async act(url, context, input) {
      check(url);
      if (!input || typeof input.id !== "string") throw new PluginError(400, "操作を指定してください");
      const action = (await load(url, context)).find(action => action.id === input.id);
      if (!action) throw new PluginError(403, "この URL またはユーザーでは実行できない操作です");
      return action.run(validate(action, input));
    },
  };
}
