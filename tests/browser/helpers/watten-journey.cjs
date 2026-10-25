const { expect } = require('@playwright/test');

async function player(browser, baseURL, language = 'de', { guide = false } = {}) {
  const context = await browser.newContext({ baseURL, reducedMotion: 'reduce' });
  const page = await context.newPage();
  if (!guide) await page.route('**/api/auth/game-guides', route => route.fulfill({ json: { enabled: false, acknowledged: {} } }));
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
  const traffic = { snapshot: null, commands: [], errors: [], call: {}, social: [], lobby: [] };
  page.on('pageerror', error => traffic.errors.push(error.message));
  page.on('websocket', socket => {
    socket.on('framesent', frame => {
      try { traffic.commands.push(JSON.parse(String(frame.payload))); } catch { /* Non-JSON protocol frame. */ }
    });
    socket.on('framereceived', frame => {
      try {
        const message = JSON.parse(String(frame.payload));
        if (Object.keys(message).some(key => key.startsWith('watten_social_'))) traffic.social.push(message);
        if (message.lobby_chat) traffic.lobby.push(message);
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

async function waitingRoomReady(players, gameId, participants) {
  const members = [...participants].sort();
  // Each mutation broadcasts separately to every recipient. Wait for the whole
  // current room before the next actor chooses a revision-bound command.
  await expect.poll(() => {
    const revision = players[0].traffic.snapshot?.room?.revision;
    return players.map(item => {
      const snapshot = item.traffic.snapshot;
      return {
        id: snapshot?.id,
        participant_id: snapshot?.viewer?.participant_id,
        members: snapshot?.room?.members.map(member => member.participant_id).sort(),
        same_revision: Number.isInteger(revision) && snapshot?.room?.revision === revision,
      };
    });
  }).toEqual(players.map((_, index) => ({
    id: gameId, participant_id: participants[index], members, same_revision: true,
  })));
  // The protocol observer can receive a frame before the controller has painted
  // it. Real waiting-room member names also confirm the current visible roster.
  for (const item of players) {
    for (const other of players.filter(peer => peer !== item)) {
      await expect(item.page.locator('.wt-waiting')).toContainText(other.user.username);
    }
  }
}

async function openCreator(page, { favorite = false } = {}) {
  await page.locator('[data-watten-create-open]').click();
  await expect(page.locator('[data-watten-create-dialog]')).toBeVisible();
  const choice = page.locator(favorite ? '[data-watten-create-favourite]' : '[data-watten-create-define]');
  await expect(choice).toBeEnabled();
  await choice.click();
  const form = page.locator('[data-watten-create]');
  await expect(form).toBeVisible();
  return form;
}

async function create(players, { count = players.length, target = 3, reference = false, partnerHand = false, schoeneres = false, tournament = null, start = true, password, determination, cpuFill = false } = {}) {
  const host = players[0];
  await host.page.goto('/watten');
  const form = await openCreator(host.page);
  await form.locator(`[name=count][value="${count}"] + span`).click();
  if (determination) await form.locator(`[name=determination][value="${determination}"] + span`).click();
  if (tournament !== null) {
    const preset = [3, 5, 8, 10, 15, 20].includes(tournament);
    await form.locator('[name=tournament_target]').selectOption(preset ? String(tournament) : 'custom');
    if (!preset) await form.locator('[name=tournament_custom]').fill(String(tournament));
  }
  await form.locator('[name=target]').selectOption(String(target));
  if (partnerHand && await form.locator('[name=blind]').isChecked()) await form.locator('[name=blind]').uncheck();
  if (reference || partnerHand || schoeneres) {
    await form.locator('[data-watten-advanced] > summary').click();
    if (reference) await form.locator('[name=show_rechter]').check();
    if (partnerHand) await form.locator('[name=partner_hand]').check();
    if (schoeneres) await form.locator('[name=schoeneres_enabled]').check();
  }
  if (password) await form.locator('[name=password]').fill(password);
  if (cpuFill) await form.locator('[name=cpu_fill]').check();
  await form.locator('button[type=submit]').click();
  await expect(host.page).toHaveURL(/\/watten\/spiel\/[0-9a-f]{16}$/);
  const path = new URL(host.page.url()).pathname;
  const gameId = path.split('/').pop();
  await expect.poll(() => host.traffic.snapshot?.id === gameId
    && host.traffic.snapshot.viewer?.participant_id).toBeTruthy();
  const participants = [host.traffic.snapshot.viewer.participant_id];
  for (let index = 1; index < players.length; index += 1) {
    await players[index].page.goto(path);
    if (password) await players[index].page.locator('[data-watten-join] [name=password]').fill(password);
    await players[index].page.locator('[data-watten-join] button[type=submit]').click();
    await expect.poll(() => players[index].traffic.snapshot?.id === gameId
      && players[index].traffic.snapshot.viewer?.participant_id).toBeTruthy();
    participants.push(players[index].traffic.snapshot.viewer.participant_id);
  }
  for (let seat = 0; seat < players.length; seat += 1) {
    await waitingRoomReady(players, gameId, participants);
    await players[seat].page.locator(`[data-watten-command=take-seat][data-seat="${seat}"]`).click();
    await expect.poll(() => players[seat].traffic.snapshot?.id === gameId
      ? players[seat].traffic.snapshot.viewer?.seat : null).toBe(seat);
    await waitingRoomReady(players, gameId, participants);
  }
  if (start) {
    await host.page.locator('[data-watten-command=start]').click();
    // Start broadcasts reach each peer separately, just like room mutations.
    // A ready host must not let callers read another peer's waiting-room engine.
    await expect.poll(() => players.every(item => item.traffic.snapshot?.id === gameId
      && item.traffic.snapshot.started && item.traffic.snapshot.engine)).toBe(true);
  }
  return path;
}

async function answerPartnerFeedback(players, value = 'unsure') {
  for (const actor of players) {
    if (!actor.traffic.snapshot?.engine?.actions.includes('partner_feedback')) continue;
    const dialog = actor.page.locator('[data-watten-feedback-dialog]');
    await expect(dialog).toBeVisible();
    await dialog.locator(`[data-watten-command=feedback][data-value="${value}"]`).click();
    await expect(dialog).toHaveCount(0);
    await expect.poll(() => actor.traffic.snapshot.engine.feedback.some(item =>
      item.sender === actor.traffic.snapshot.viewer.participant_id && item.value === value)).toBe(true);
  }
}

async function action(players, kind, value) {
  await expect.poll(() => players.some(item => item.traffic.snapshot?.engine?.actions.includes(kind))).toBe(true);
  const actor = players.find(item => item.traffic.snapshot?.engine?.actions.includes(kind));
  if (kind.startsWith('respond_')) await answerPartnerFeedback([actor]);
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
  // Prefer an ordinary trump when duty applies. This driver need not duplicate
  // the trick ranking just to decide whether a strike can actually overtake.
  return duty ? cards.find(card => trump(card) && !strike(card)) : cards[0];
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

async function finishOpenMatch(players, options = {}) {
  const path = await create(players, options);
  await normalCall(players);
  await playOne(players);
  await action(players, 'bid');
  await action(players, 'respond_hold', 'hold');
  for (let index = 0; index < players.length * 5 && players[0].traffic.snapshot.engine.phase === 'play'; index += 1) await playOne(players);
  for (const item of players) await expect(item.page.locator('[data-watten-match-result]')).toBeVisible({ timeout: 10000 });
  return path;
}

module.exports = { player, openCreator, create, action, answerPartnerFeedback, normalCall, playOne, finishOpenMatch };
