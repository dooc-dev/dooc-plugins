import assert from "node:assert/strict";
import { test } from "node:test";
import { view } from "../src/common.js";
import { render } from "./render.js";

test("Header metadata stays separate from theme-owned content and collapsed summaries", () => {
  const result = view({ service: "Linear", title: "DOC-42 · Editable title", sourceUrl: "https://linear.app/acme/issue/DOC-42", sections: [{ title: "Details", data: { identifier: "DOC-42", project: { name: "Project" } } }], body: "Card content", kind: "issue" });
  assert.equal(result.header?.title, "Linear"); assert.equal(result.header?.context, "Project"); assert.equal(result.header?.reference, "DOC-42");
  assert.match(render(result), /Editable title/); assert.match(render(result), /Card content/);
  assert(!render(result).includes("<style>")); assert(!render(result).includes("<iframe"));
  assert.match(render(result.collapsed), /Editable title/);
});
