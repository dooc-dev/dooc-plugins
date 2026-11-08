import type { BrowserPage } from "./browser.js";

export default async (page: BrowserPage, origin = "http://localhost:5183") => {
  const results = [];
  for (const width of [1440, 940, 390]) {
    await page.setViewportSize({ width, height: 1000 }); await page.goto(`${origin}/overview?lang=jpn`);
    await page.waitForFunction(() => document.querySelectorAll('[data-actions-ready="true"]').length === 3);
    for (const service of ['linear', 'github', 'slack']) {
      const card = page.locator(`[data-plugin="${service}"]`);
      if (await card.locator('iframe').count()) throw new Error('Block cards must use host DOM');
      const layout = await card.evaluate(e => {
        const box = e.getBoundingClientRect(), icon = e.querySelector('.plugin-heading img')!.getBoundingClientRect(), title = e.querySelector('.plugin-block-heading')!.getBoundingClientRect();
        return { overflow: e.scrollWidth > e.clientWidth + 4, top: icon.y + icon.height / 2 - box.y, title: title.y - box.y, width: title.width, font: getComputedStyle(e.querySelector('.plugin-blocks')!).fontFamily };
      });
      if (layout.overflow || Math.abs(layout.top) > 2 || layout.title < 12 || layout.width < 50) throw new Error(`${service}/${width}: invalid card layout ${JSON.stringify(layout)}`);
      const icon = await card.locator('.plugin-heading img').evaluate(e => (e as HTMLImageElement).src);
      await card.locator('[data-plugin-action="fold"]').click(); await card.locator('[data-plugin-result]').waitFor({ state: 'hidden' });
      if (await card.locator('.plugin-heading img').evaluate(e => (e as HTMLImageElement).src) !== icon) throw new Error('Fold changed the service icon');
      await card.locator('[data-plugin-action="fold"]').click();
      results.push({ service, viewport: width, ...layout });
    }
  }
  let lightIcon = '';
  for (const theme of ['light', 'dark']) {
    await page.locator('html').evaluate(e => { e.removeAttribute('data-theme'); });
    await page.emulateMedia({ colorScheme: theme as 'light' | 'dark' });
    await page.waitForFunction(() => [...document.querySelectorAll<HTMLImageElement>('img[data-plugin-icon-dark]')].every(image => image.src === (getComputedStyle(image).colorScheme === 'dark' ? image.dataset.pluginIconDark : image.dataset.pluginIconLight)));
    const colors = await page.locator('[data-plugin="github"]').evaluate(e => ({ bg: getComputedStyle(e).backgroundColor, fg: getComputedStyle(e).color, scheme: getComputedStyle(e).colorScheme, icon: (e.querySelector('.plugin-heading img') as HTMLImageElement).src, expected: (e.querySelector('.plugin-heading img') as HTMLElement).dataset.pluginIconDark }));
    if (colors.scheme !== theme || colors.bg === colors.fg) throw new Error(`Invalid ${theme} theme`);
    if (theme === 'light') lightIcon = colors.icon;
    else if (colors.icon === lightIcon || colors.icon !== colors.expected) throw new Error('The dark theme did not select its icon');
    results.push({ theme, bg: colors.bg, fg: colors.fg, scheme: colors.scheme });
  }
  await page.emulateMedia({ colorScheme: null });
  await page.setViewportSize({ width: 1440, height: 1000 });
  return results;
};
