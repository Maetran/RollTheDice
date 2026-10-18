const { expect } = require('@playwright/test');

async function openHausdeppWaiting(page, { players = 2, cpu = 0, tournament = false, open = false } = {}) {
  await page.locator('#hausdeppCreate').click();
  await page.locator('[data-create-define]').click();
  await page.locator(`[name="waiting_mode"][value="${open ? 'open' : 'fixed'}"]`).check();
  if (!open) await page.locator('[name="players"]').selectOption(String(players));
  await page.locator(`[name="tournament"][value="${tournament}"]`).check();
  await page.locator('#hausdeppOpenWaiting').click();
  await expect(page.locator('#hausdeppWaiting')).toBeVisible();
  for (let count = 1; count <= cpu; count += 1) {
    await page.locator('#hausdeppAddCpu').click();
    await expect(page.locator('[data-waiting-action="remove"]')).toHaveCount(count);
  }
}

async function startHausdeppCpuGame(page, settings = {}) {
  await openHausdeppWaiting(page, { players: 2, cpu: 1, ...settings });
  await expect(page.locator('#hausdeppStartGame')).toBeEnabled();
  await page.locator('#hausdeppStartGame').click();
  await expect(page.locator('#hausdeppWaiting')).toBeHidden();
}

module.exports = { openHausdeppWaiting, startHausdeppCpuGame };
