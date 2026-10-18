const { expect } = require('@playwright/test');

async function player(browser, baseURL, language = 'de') {
  const context = await browser.newContext({ baseURL, reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.addInitScript(value => {
    if (!localStorage.getItem('zdwa_language')) localStorage.setItem('zdwa_language', value);
  }, language);
  const username = `Watter${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
  const ownerLogin = await context.request.post('/api/auth/login', { data: {
    username: 'Admin', password: 'temporary-password-123',
  } });
  expect(ownerLogin.ok()).toBeTruthy();
  const owner = (await ownerLogin.json()).user;
  const password = 'watten-test-password-123';
  const response = await context.request.post('/api/admin/users', {
    headers: { 'X-CSRF-Token': owner.csrf_token }, data: { username, temporary_password: password, role: 'user' },
  });
  expect(response.status()).toBe(201);
  const signedIn = await context.request.post('/api/auth/login', { data: { username, password } });
  expect(signedIn.ok()).toBeTruthy();
  let user = (await signedIn.json()).user;
  expect((await context.request.post('/api/auth/change-password', {
    headers: { 'X-CSRF-Token': user.csrf_token }, data: { current_password: password, new_password: `${password}-final` },
  })).ok()).toBeTruthy();
  const finalLogin = await context.request.post('/api/auth/login', { data: { username, password: `${password}-final` } });
  expect(finalLogin.ok()).toBeTruthy();
  user = (await finalLogin.json()).user;
  expect(user.is_owner).toBeFalsy();
  expect((await context.request.put('/api/auth/preferences/language', {
    headers: { 'X-CSRF-Token': user.csrf_token }, data: { preferred_language: language },
  })).ok()).toBeTruthy();
  const traffic = { snapshot: null, commands: [], errors: [], call: {} };
  page.on('pageerror', error => traffic.errors.push(error.message));
  page.on('websocket', socket => {
    socket.on('framesent', frame => {
      try { traffic.commands.push(JSON.parse(String(frame.payload))); } catch { /* Non-JSON protocol frame. */ }
    });
    socket.on('framereceived', frame => {
      try {
        const message = JSON.parse(String(frame.payload));
        if (message.scoreboard) {
          const snapshot = message.scoreboard;
          const engine = snapshot.engine;
          if (engine?.deal_id !== traffic.snapshot?.engine?.deal_id) traffic.call = {};
          for (const call of snapshot.pending_call_events || []) {
            if (call.kind === 'strike_announced') traffic.call.strike = call.value;
            if (call.kind === 'colour_announced') traffic.call.suit = call.value;
          }
          for (const shown of engine?.inspection?.cards || []) {
            const [suit, rank] = shown.card.split('-');
            if (shown.role === 'strike') traffic.call.strike = shown.card === 'bells-6' ? 'weli' : rank;
            if (shown.role === 'colour') traffic.call.suit = suit;
          }
          traffic.snapshot = snapshot;
        }
      } catch { /* Non-JSON protocol frame. */ }
    });
  });
  return { context, page, user, traffic };
}

async function create(players, { count = players.length, target = 3, reference = false, start = true } = {}) {
  const host = players[0];
  await host.page.goto('/watten');
  const form = host.page.locator('[data-watten-create]');
  await expect(form).toBeVisible();
  await form.locator(`[name=count][value="${count}"] + span`).click();
  await form.locator('[name=target]').selectOption(String(target));
  if (reference) {
    await form.locator('summary').click();
    await form.locator('[name=show_rechter]').check();
  }
  await form.locator('button[type=submit]').click();
  await expect(host.page).toHaveURL(/\/watten\/spiel\/[0-9a-f]{16}$/);
  await expect.poll(() => host.traffic.snapshot?.viewer?.participant_id).toBeTruthy();
  const path = new URL(host.page.url()).pathname;
  for (let index = 1; index < players.length; index += 1) {
    await players[index].page.goto(path);
    await players[index].page.locator('[data-watten-join] button[type=submit]').click();
    await expect.poll(() => players[index].traffic.snapshot?.viewer?.participant_id).toBeTruthy();
  }
  for (let seat = 0; seat < players.length; seat += 1) {
    await players[seat].page.locator(`[data-watten-command=take-seat][data-seat="${seat}"]`).click();
    await expect.poll(() => players[seat].traffic.snapshot?.viewer?.seat).toBe(seat);
  }
  if (start) {
    await host.page.locator('[data-watten-command=start]').click();
    await expect.poll(() => host.traffic.snapshot?.started).toBe(true);
  }
  return path;
}

async function action(players, kind, value) {
  await expect.poll(() => players.some(item => item.traffic.snapshot?.engine?.actions.includes(kind))).toBe(true);
  const actor = players.find(item => item.traffic.snapshot?.engine?.actions.includes(kind));
  const opportunity = actor.traffic.snapshot.engine.opportunity;
  const selector = `[data-watten-action="${kind}"]${value === undefined ? '' : `[data-value="${value}"]`}`;
  await actor.page.locator(selector).first().click();
  await expect.poll(() => actor.traffic.snapshot.engine.opportunity).not.toBe(opportunity);
  return actor;
}

async function normalCall(players) {
  const striker = await action(players, 'announce_strike', '7');
  const colourer = await action(players, 'announce_colour', 'bells');
  await expect.poll(() => players.every(item => item.traffic.snapshot?.engine?.phase === 'play')).toBe(true);
  return { striker, colourer };
}

function legalOrdinaryCallCard(view) {
  const cards = view.hand.map(item => item.card);
  const lead = view.current_trick.cards[0]?.card;
  const trump = card => card.startsWith('bells-');
  const strike = card => card.endsWith('-7');
  // This driver announces seven/bells openly, with critical cards OFF.
  const duty = lead && trump(lead) && cards.some(card => trump(card) && !strike(card));
  return (duty ? cards.filter(card => trump(card) || strike(card)) : cards)[0];
}

async function playOne(players) {
  await expect.poll(() => players.some(item => item.traffic.snapshot?.engine?.actions.includes('play_card'))).toBe(true);
  const actor = players.find(item => item.traffic.snapshot.engine.actions.includes('play_card'));
  const before = actor.traffic.snapshot.engine.opportunity;
  const card = legalOrdinaryCallCard(actor.traffic.snapshot.engine);
  const button = actor.page.locator(`[data-wt-hand] button[data-card="${card}"]`);
  await expect(button).toBeEnabled();
  await button.press('Enter');
  await expect.poll(() => actor.traffic.snapshot.engine.opportunity).not.toBe(before);
}

async function finishOpenMatch(players) {
  const path = await create(players);
  await normalCall(players);
  await playOne(players);
  await action(players, 'bid');
  await action(players, 'respond_hold', 'hold');
  for (let index = 0; index < 12 && players[0].traffic.snapshot.engine.phase === 'play'; index += 1) await playOne(players);
  for (const item of players) await expect(item.page.locator('[data-watten-match-result]')).toBeVisible();
  return path;
}

module.exports = { player, create, action, normalCall, playOne, finishOpenMatch };
