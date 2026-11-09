import type { BrowserPage } from "./browser.js";

export default async (page: BrowserPage, origin = "http://localhost:5183") => {
  await page.goto(`${origin}/overview?lang=jpn`);
  await page.waitForFunction(() => document.querySelectorAll('[data-actions-ready="true"]').length === 3);
  const results: string[] = [];
  for (const service of ["linear", "github", "slack"]) {
    const card = page.locator(`[data-plugin="${service}"]`), create = service === "slack" ? "reply.create" : "comment.create";
    await card.locator('[data-plugin-action="edit"]').click();
    const composer = card.locator(`[data-block-composer][data-block-action="${create}"]`);
    await composer.locator('button').click();
    const marker = `Block comment ${service} ${Date.now()}`;
    await composer.locator('textarea').fill(marker); await composer.locator('button[type="submit"]').click();
    let message = card.locator('.plugin-block-message').filter({ hasText: marker });
    await message.waitFor({ state: "visible" });
    await page.waitForFunction(() => !document.querySelector('.plugin[aria-busy="true"]'));
    await message.locator('[data-plugin-edit-trigger]').dblclick(); await message.locator('textarea').fill(`${marker} edited`);
    await message.locator('textarea').press('Control+Enter');
    await card.locator('.plugin-block-heading').click();
    await message.locator('[data-plugin-edit-trigger]').filter({ hasText: `${marker} edited` }).waitFor({ state: 'visible' });
    await page.waitForFunction(() => !document.querySelector('.plugin[aria-busy="true"]'));
    await message.locator('.plugin-message-actions button').click();
    const dialog = page.locator('dialog[open]');
    await dialog.locator('button').evaluateAll(elements => { (elements[0] as HTMLButtonElement).click(); });
    if (!await message.count()) throw new Error('Cancel deleted the comment');
    await message.locator('.plugin-message-actions button').click();
    await dialog.locator('button.danger').click();
    await message.waitFor({ state: 'hidden' });
    await page.waitForFunction(() => !document.querySelector('.plugin[aria-busy="true"]'));
    results.push(`${service}: create, edit, cancel deletion and confirmed deletion through native blocks`);
  }
  const slack = page.locator('[data-plugin="slack"]');
  const reaction = slack.locator('.plugin-reactions button').filter({ hasText: '👀' });
  const previous = await reaction.evaluate(e => e.getAttribute('aria-pressed'));
  await reaction.click();
  await page.waitForFunction(() => !document.querySelector('.plugin[aria-busy="true"]'));
  if (await reaction.evaluate(e => e.getAttribute('aria-pressed')) === previous) throw new Error('Reaction did not toggle');
  results.push('Slack reactions toggle through the provider action API');
  return results;
};
