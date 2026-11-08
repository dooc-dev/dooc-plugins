import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";

// Run against npm run dev; restore the temporary provider source change in finally.
const origin = process.argv[2] ?? "http://localhost:5179";
const source = new URL("../../src/cards.ts", import.meta.url);
const original = await readFile(source, "utf8"), marker = 'const title = text(displayTitle, 500);';
assert(original.includes(marker));
const first = original.replace(marker, 'const title = text(`Reload probe ${displayTitle}`, 500);');
const broken = `${first}\nconst hotReloadCheck: string = 1;\n`;
const bootId = async () => {
  const response = await fetch(`${origin}/api/hmr`), reader = response.body!.getReader();
  let text = "";
  try {
    while (!text.includes('"bootId"')) { const { value, done } = await reader.read(); assert(!done); text += new TextDecoder().decode(value); }
    return JSON.parse(text.match(/data: (.*)/)![1]).bootId as string;
  } finally { await reader.cancel(); }
};
const changed = async (previous: string) => {
  for (let attempt = 0; attempt < 100; attempt++) {
    try { const next = await bootId(); if (next !== previous) return next; } catch { /* Preview restarts briefly close connections. */ }
    await setTimeout(150);
  }
  throw new Error("Preview did not restart after successful compilation");
};
try {
  const initial = await bootId(); await writeFile(source, first);
  const next = await changed(initial); await writeFile(source, broken); await setTimeout(3000);
  assert.equal(await bootId(), next, "Type errors must retain the running preview");
  await writeFile(source, first); await changed(next);
  console.log("Native plugin hot reload, failed-build retention and recovery passed.");
} finally {
  const current = await readFile(source, "utf8");
  if ([first, broken].includes(current)) await writeFile(source, original);
}
