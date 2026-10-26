const { test, expect } = require('@playwright/test');
const { player, openCreator } = require('./helpers/watten-journey.cjs');

for (const language of ['de', 'en']) {
  test(`${language}: a protected favorite keeps CPU, voice and Schöneres settings without restoring a password or creating automatically`, async ({ browser, baseURL }) => {
    const own = await player(browser, baseURL, language, { role: 'admin' });
    const stranger = await player(browser, baseURL, language);
    const creates = [];
    own.page.on('request', request => {
      if (new URL(request.url()).pathname === '/api/games' && request.method() === 'POST') creates.push(request);
    });
    try {
      await own.page.goto('/watten');
      const form = await openCreator(own.page);
      await form.locator('[name=count][value="2"] + span').click();
      await form.locator('[name=determination][value=ladinisch] + span').click();
      await form.locator('[name=tournament_target]').selectOption('custom');
      await form.locator('[name=tournament_custom]').fill('37');
      await form.locator('[data-watten-advanced] summary').click();
      await form.locator('[name=critical]').check();
      await expect(form.locator('[name=schoeneres_enabled]')).not.toBeChecked();
      await form.locator('[name=schoeneres_enabled]').check();
      await form.locator('[name=trick_history]').check();
      await form.locator('[name=cpu_fill]').check();
      await form.locator('[name=voice_enabled]').uncheck();
      await form.locator('[data-watten-password]').fill('first-favorite-password');
      await form.locator('.wt-create-favorite > summary').click();
      await own.page.locator('[data-watten-favorite-action=save]').click();
      await expect.poll(async () => (await (await own.context.request.get('/api/watten/favorite')).json()).recipe?.password_required).toBe(true);
      const saved = await own.context.request.get('/api/watten/favorite');
      expect(await saved.text()).not.toContain('first-favorite-password');
      const recipe = (await saved.json()).recipe;
      expect(recipe.cpu_seats).toEqual([1]); expect(recipe.player_count).toBe(2);
      expect(recipe.critical).toBe(true); expect(recipe.determination).toBe('ladinisch');
      expect(recipe.voice_enabled).toBe(false);
      expect(recipe.schoeneres_enabled).toBe(true);
      expect(recipe.tournament_nockerl_target).toBe(37);
      expect((await (await stranger.context.request.get('/api/watten/favorite')).json()).recipe).toBeNull();
      await form.locator('[name=count][value="3"] + span').click();
      await expect(form.locator('[name=schoeneres_enabled]')).toBeDisabled();
      await expect(form.locator('[name=schoeneres_enabled]')).not.toBeChecked();
      await expect(form.locator('[name=tournament_target]')).toBeDisabled();
      await expect(form.locator('[name=tournament_target]')).toHaveValue('');
      await expect(form.locator('[name=tournament_custom]')).toBeHidden();
      await form.locator('[name=count][value="4"] + span').click();
      await expect(form.locator('[name=schoeneres_enabled]')).toBeEnabled();
      await form.locator('[data-watten-create-back]').click();
      await own.page.locator('[data-watten-create-favourite]').click();
      await expect(form.locator('[name=count][value="2"]')).toBeChecked();
      await expect(form.locator('[data-watten-password]')).toHaveValue('');
      await expect(form.locator('[name=cpu_fill]')).toBeChecked();
      await expect(form.locator('[name=voice_enabled]')).not.toBeChecked();
      await expect(form.locator('[name=schoeneres_enabled]')).toBeChecked();
      await expect(form.locator('[name=tournament_target]')).toHaveValue('custom');
      await expect(form.locator('[name=tournament_custom]')).toHaveValue('37');
      await expect(own.page).toHaveURL(/\/watten$/);
      expect(creates).toHaveLength(0);
      await form.locator('[data-watten-password]').fill('new-fresh-favorite-password');
      await form.locator('button[type=submit]').click();
      await expect(own.page).toHaveURL(/\/watten\/spiel\/[0-9a-f]{16}$/);
      await expect.poll(() => own.traffic.snapshot?.room?.recipe?.password_required).toBe(true);
      expect(own.traffic.snapshot.started).toBe(false);
      expect(own.traffic.snapshot.room.recipe.cpu_seats).toEqual([1]);
      expect(own.traffic.snapshot.room.recipe.voice_enabled).toBe(false);
      expect(own.traffic.snapshot.room.recipe.schoeneres_enabled).toBe(true);
      expect(own.traffic.snapshot.room.recipe.tournament_nockerl_target).toBe(37);
      await expect(own.page.locator('.wt-waiting .wt-recipe')).toContainText(language === 'de' ? 'Schöneres' : 'Redeal by agreement');
      expect(own.traffic.snapshot.room.seats[1].is_cpu).toBe(true);
      await own.page.goto('/watten');
      const next = await openCreator(own.page, { favorite: true });
      await expect(next.locator('[data-watten-password]')).toHaveValue('');
      // With no password entered this deliberate creation is public.
      await next.locator('button[type=submit]').click();
      await expect(own.page).toHaveURL(/\/watten\/spiel\/[0-9a-f]{16}$/);
      await expect.poll(() => own.traffic.snapshot?.room?.recipe?.password_required).toBe(false);
      expect(own.traffic.snapshot.started).toBe(false);
      expect((await (await own.context.request.get('/api/watten/favorite')).json()).recipe.password_required).toBe(true);
      await own.page.goto('/watten');
      const savedForm = await openCreator(own.page, { favorite: true });
      if (!await savedForm.locator('.wt-create-favorite').evaluate(node => node.open)) {
        await savedForm.locator('.wt-create-favorite > summary').click();
      }
      await own.page.locator('[data-watten-favorite-action=delete]').click();
      await expect.poll(async () => (await (await own.context.request.get('/api/watten/favorite')).json()).recipe).toBeNull();
      expect(own.traffic.errors).toEqual([]);
    } finally { await Promise.allSettled([own.context.close(), stranger.context.close()]); }
  });
}
