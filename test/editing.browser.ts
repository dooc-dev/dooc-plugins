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
      const composer = card.locator('[data-block-composer][data-block-action="comment.create"]');
      if (!await composer.locator('button').evaluate(e => (e as HTMLButtonElement).disabled)) throw new Error("Read mode allowed a write");
      await card.locator('[data-plugin-action="edit"]').click();
      await composer.locator('button').click();
      await composer.locator('textarea').fill('Keep this unsent comment during autosave');
      const title = card.locator('.plugin-block-heading');
      const editedTitle = `Edited ${service} ${Date.now()}`;
      await title.locator('[data-plugin-edit-trigger]').dblclick();
      await title.locator('input').fill(editedTitle);
      await title.locator('input').press('Tab');
      await title.locator('form').waitFor({ state: "hidden" });
      if (await composer.locator('textarea').inputValue() !== 'Keep this unsent comment during autosave') throw new Error("Autosave discarded the comment draft");
      await composer.locator('button[type="submit"]').click();
      await composer.locator('form').waitFor({ state: 'hidden' });
      await page.waitForFunction(() => !document.querySelector('.plugin[aria-busy="true"]'));
      await title.locator('[data-plugin-edit-trigger]').filter({ hasText: editedTitle }).waitFor({ state: "visible" });

      const body = card.locator(`[data-block-edit='{"action":"${action}","field":"body"}']`);
      await body.locator('[data-plugin-edit-trigger]').dblclick();
      const draft = `Draft body ${service} ${Date.now()}`, before = writes;
      fail = true;
      await body.locator('textarea').fill(draft);
      await body.locator('.plugin-editor-notice').filter({ hasText: "Fixture denied this save" }).waitFor({ state: "visible" });
      if (writes !== before + 1 || await body.locator('textarea').inputValue() !== draft) throw new Error("Failure lost the draft or retried the write");
      fail = false;
      await body.locator('textarea').fill(`${draft} retry`);
      await body.locator('textarea').press('Control+Enter');
      await title.click();
      await body.locator('[data-plugin-edit-trigger]').filter({ hasText: `${draft} retry` }).waitFor({ state: "visible" });
      const state = card.locator(`[data-block-edit='{"action":"${action}","field":"state"}']`);
      await state.locator('[data-plugin-edit-trigger]').dblclick();
      const choice = await state.locator('select').evaluate(element => [...(element as HTMLSelectElement).options].find(option => option.value !== (element as HTMLSelectElement).value)!.value);
      await state.locator('select').selectOption(choice);
      await state.locator('select').press('Tab');
      await state.locator('form').waitFor({ state: 'hidden' });
      await page.waitForFunction(() => !document.querySelector('.plugin[aria-busy="true"]'));
      const resize = card.locator('.plugin-resize'); await resize.press('End');
      const height = await card.locator('[data-plugin-result]').evaluate(e => e.style.height);
      await card.locator('[data-plugin-action="fold"]').click(); await card.locator('[data-plugin-result]').waitFor({ state: 'hidden' });
      await card.locator('[data-plugin-action="fold"]').click();
      if (await card.locator('[data-plugin-result]').evaluate(e => e.style.height) !== height) throw new Error('Fold lost custom height');
      await card.locator('[data-plugin-action="edit"]').click();
      await page.locator(`[data-plugin="${service}"][data-editing="false"]`).waitFor({ state: 'visible' });
      if (!await composer.locator('button').evaluate(e => (e as HTMLButtonElement).disabled)) throw new Error("Leaving edit mode allowed a write");
      results.push(`${service}: edit mode, title/body/status autosave, comment draft retention, failed save, explicit retry and resized fold`);
    }
  } finally { await page.unroute("**/api/plugins"); }
  await page.goto(`${origin}/overview/github?lang=jpn`);
  await page.waitForFunction(() => document.querySelectorAll('[data-actions-ready="true"]').length === 4);
  const fileCard = page.locator('[data-plugin="github"][data-url*="/blob/"]');
  await fileCard.locator('[data-plugin-action="edit"]').click();
  const file = fileCard.locator(`[data-block-edit='{"action":"file.update"}']`);
  const content = `export const preview = "日本語";`;
  await file.locator('[data-plugin-edit-trigger]').dblclick();
  await file.locator('textarea[name="body"]').fill(content);
  await file.locator('input[name="message"]').fill('Update preview fixture');
  await fileCard.locator('[data-plugin-action="edit"]').click();
  await file.locator('[data-plugin-edit-trigger]').filter({ hasText: content }).waitFor({ state: 'visible' });
  await page.waitForFunction(() => !document.querySelector('.plugin[aria-busy="true"]'));
  await fileCard.locator('[data-plugin-action="edit"]').click();
  await file.locator('[data-plugin-edit-trigger]').dblclick();
  if (await file.locator('textarea[name="body"]').inputValue() !== content) throw new Error('File edit lost the saved content');
  await fileCard.locator('[data-plugin-action="edit"]').click();
  const project = page.locator('[data-plugin="github"][data-url*="/projects/"]');
  await project.locator('[data-plugin-action="edit"]').click();
  const status = project.locator(`[data-block-edit='{"action":"item.field/I2/status-field","field":"value"}']`);
  await status.locator('[data-plugin-edit-trigger]').dblclick(); await status.locator('select').selectOption('done');
  await status.locator('select').press('Tab'); await status.locator('form').waitFor({ state: 'hidden' });
  results.push('GitHub: UTF-8 file edit with commit message, refreshed content and project field autosave');
  return results;
};
