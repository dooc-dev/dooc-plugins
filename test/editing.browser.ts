import type { BrowserPage } from "./browser.js";

export default async (page: BrowserPage, origin = "http://localhost:5183") => {
  const results: string[] = [];
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${origin}/overview?lang=jpn`);
  await page.waitForFunction(() => document.querySelectorAll('[data-actions-ready="true"]').length === 3);
  let writes = 0, fail = false;
  await page.route("**/api/plugins", async route => {
    if (route.request().postDataJSON().action === "act") {
      writes++;
      if (fail) { await route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: "Fixture denied this save" }) }); return; }
    }
    await route.continue();
  });
  try {
    for (const service of ["linear", "github"]) {
      const card = page.locator(`[data-plugin="${service}"]`), action = service === "linear" ? "issue.update" : "resource.update";
      const body = card.locator(`[data-block-edit='{"action":"${action}","field":"body"}']`);
      const draft = `Draft body ${service} ${Date.now()}`;
      await body.locator('.plugin-edit-display').click();
      const bodyForm = body.locator("form"); await bodyForm.locator("textarea").fill(draft);
      const title = card.locator('.plugin-block-heading');
      await title.locator('.plugin-edit-display').click();
      await title.locator('input').fill(`Edited ${service}`);
      await title.locator('button[type="submit"]').click();
      await title.locator('.plugin-edit-display').filter({ hasText: `Edited ${service}` }).waitFor({ state: "visible" });
      if (await bodyForm.locator('textarea').inputValue() !== draft) throw new Error("Title save discarded the body draft");
      await page.waitForFunction(() => !document.querySelector('.plugin[aria-busy="true"]'));
      fail = true;
      const before = writes;
      await bodyForm.locator('button[type="submit"]').click();
      await bodyForm.locator('.plugin-editor-notice').filter({ hasText: "Fixture denied this save" }).waitFor({ state: "visible" });
      if (writes !== before + 1 || await bodyForm.locator('textarea').inputValue() !== draft) throw new Error("Failure lost the draft or retried the write");
      fail = false;
      await bodyForm.locator('textarea').press('Control+Enter');
      await body.locator('.plugin-edit-display').filter({ hasText: draft }).waitFor({ state: "visible" });
      await page.waitForFunction(() => !document.querySelector('.plugin[aria-busy="true"]'));
      await body.locator('.plugin-edit-display').click(); await body.locator('textarea').fill("Cancel me"); await body.locator('textarea').press('Escape');
      await body.locator('.plugin-edit-display').filter({ hasText: draft }).waitFor({ state: "visible" });
      const state = card.locator(`[data-block-edit='{"action":"${action}","field":"state"}']`);
      await state.locator('.plugin-edit-display').click();
      const old = await state.locator('select').inputValue(), next = service === 'linear' ? old === 'done' ? 'started' : 'done' : old === 'open' ? 'closed' : 'open';
      const choice = await state.locator('select').evaluate(element => [...(element as HTMLSelectElement).options].find(option => option.value !== (element as HTMLSelectElement).value)?.value ?? '');
      await state.locator('select').selectOption(choice || next); await state.locator('button[type="submit"]').click();
      await state.locator('form').waitFor({ state: 'hidden' });
      await page.waitForFunction(() => !document.querySelector('.plugin[aria-busy="true"]'));
      const resize = card.locator('.plugin-resize'); await resize.press('End');
      const height = await card.locator('[data-plugin-result]').evaluate(e => e.style.height);
      await card.locator('[data-plugin-action="fold"]').click(); await card.locator('[data-plugin-result]').waitFor({ state: 'hidden' });
      await card.locator('[data-plugin-action="fold"]').click();
      if (await card.locator('[data-plugin-result]').evaluate(e => e.style.height) !== height) throw new Error('Fold lost custom height');
      await body.locator('.plugin-edit-display').click();
      await body.locator('textarea').fill('Preserve this draft during a comment');
      const composer = card.locator('[data-block-action="comment.create"]');
      await composer.locator('button').click(); await composer.locator('textarea').fill('Comment refresh fixture');
      await composer.locator('button[type="submit"]').click(); await composer.locator('form').waitFor({ state: 'hidden' });
      if (await body.locator('textarea').inputValue() !== 'Preserve this draft during a comment') throw new Error('Comment refresh discarded another open draft');
      await page.waitForFunction(() => !document.querySelector('.plugin[aria-busy="true"]'));
      await body.locator('textarea').press('Escape');
      results.push(`${service}: title/body/status editing, draft retention through comment refresh, save failure, retry, keyboard cancel and resized fold`);
    }
  } finally { await page.unroute("**/api/plugins"); }
  await page.goto(`${origin}/overview/github?lang=jpn`);
  await page.waitForFunction(() => document.querySelectorAll('[data-actions-ready="true"]').length === 4);
  const file = page.locator(`[data-block-edit='{"action":"file.update"}']`);
  const content = `export const preview = "日本語";`;
  await file.locator('.plugin-edit-display').click();
  await file.locator('textarea[name="body"]').fill(content);
  await file.locator('input[name="message"]').fill('Update preview fixture');
  await file.locator('button[type="submit"]').click();
  await file.locator('.plugin-edit-display').filter({ hasText: content }).waitFor({ state: 'visible' });
  await page.waitForFunction(() => !document.querySelector('.plugin[aria-busy="true"]'));
  await file.locator('.plugin-edit-display').click();
  if (await file.locator('textarea[name="body"]').inputValue() !== content) throw new Error('File edit lost the saved content');
  await file.locator('textarea').press('Escape');
  const status = page.locator(`[data-block-edit='{"action":"item.field/I2/status-field","field":"value"}']`);
  await status.locator('.plugin-edit-display').click(); await status.locator('select').selectOption('done');
  await status.locator('button[type="submit"]').click(); await status.locator('form').waitFor({ state: 'hidden' });
  results.push('GitHub: UTF-8 file edit with commit message, refreshed content and project field editing');
  return results;
};
