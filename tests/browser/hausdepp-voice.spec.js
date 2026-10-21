const { test, expect } = require('@playwright/test');
const { mkdir } = require('node:fs/promises');
const path = require('node:path');

test.use({ serviceWorkers: 'block' });
test.beforeAll(({ baseURL }) => expect(['8000', '8001']).not.toContain(new URL(baseURL).port));

// Accounts, tables, gameplay, rematch creation and socket authorization remain
// real. Only the external SFU signalling actions and browser media devices are
// simulated; these tests cannot establish actual acoustic/device quality.
async function installMedia(page, language) {
  await page.addInitScript(value => {
    localStorage.setItem('zdwa_language', value);
    const NativeContext = window.AudioContext || window.webkitAudioContext;
    const harness = window.__voiceHarness = { captures: 0, tracks: [], peers: [], playbackBlocked: false, microphoneDenied: false };
    const mediaContext = new NativeContext();
    const audioTrack = () => mediaContext.createMediaStreamDestination().stream.getAudioTracks()[0];
    const nativePlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      if (this.srcObject) return harness.playbackBlocked ? Promise.reject(new DOMException('Blocked', 'NotAllowedError')) : Promise.resolve();
      return nativePlay.call(this);
    };
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async () => {
      harness.captures++;
      if (harness.microphoneDenied) throw new DOMException('Microphone denied', 'NotAllowedError');
      const track = audioTrack(); harness.tracks.push(track);
      return new MediaStream([track]);
    } });
    window.RTCPeerConnection = class extends EventTarget {
      constructor(configuration) {
        super(); this.configuration = configuration; this.iceGatheringState = 'complete';
        this.connectionState = 'new'; this.signalingState = 'stable'; this.transceivers = [];
        harness.peers.push(this);
      }
      addTransceiver(track, options) {
        const item = { mid: '0', direction: options.direction, sender: { track,
          async replaceTrack(next) { this.track = next; } } };
        this.transceivers.push(item); return item;
      }
      async createOffer() { return { type: 'offer', sdp: 'test-local-offer' }; }
      async createAnswer() { return { type: 'answer', sdp: 'test-local-answer' }; }
      async setLocalDescription(description) {
        this.localDescription = description;
        this.signalingState = description.type === 'offer' ? 'have-local-offer' : 'stable';
      }
      async setRemoteDescription(description) {
        this.remoteDescription = description;
        this.signalingState = description.type === 'offer' ? 'have-remote-offer' : 'stable';
        if (description.type === 'offer') for (const mid of JSON.parse(description.sdp)) {
          const event = new Event('track'); event.track = audioTrack(); event.transceiver = { mid };
          this.dispatchEvent(event);
        }
        if (description.type === 'answer') {
          this.connectionState = 'connected';
          this.dispatchEvent(new Event('connectionstatechange'));
        }
      }
      async getStats() { return new Map(); }
      close() { this.connectionState = 'closed'; this.dispatchEvent(new Event('connectionstatechange')); }
    };
    const NativeWebSocket = window.WebSocket;
    window.WebSocket = class extends NativeWebSocket {
      constructor(url, protocols) {
        super(url, protocols);
        if (/\/ws\/[a-f0-9]{8}$/.test(new URL(url, location.href).pathname)) window.__voiceGameSocket = this;
      }
    };
  }, language);
  await page.route('**/api/releases**', route => route.fulfill({ json: { releases: [], can_prompt: false } }));
  await page.route('**/api/auth/game-guides', route => route.fulfill({ json: { enabled: false, acknowledged: {} } }));
  await page.route('**/api/auth/tours/offer', route => route.fulfill({ json: { show: false, enabled: false, games: {} } }));
  await page.route('**/api/hausdepp/progress-notices', route => route.fulfill({ json: { notices: [], revision: 0 } }));
}

async function fixture(page, browser, baseURL, language = 'de', { mockVoice = true } = {}) {
  const login = await page.request.post('/api/auth/login', { data: { username: 'Admin', password: 'temporary-password-123' } });
  expect(login.ok()).toBeTruthy();
  const owner = (await login.json()).user, headers = { 'X-CSRF-Token': owner.csrf_token };
  const originalLanguage = owner.preferences?.preferred_language || 'de';
  await page.request.put('/api/auth/preferences/language', { headers, data: { preferred_language: language } });
  const guestContext = await browser.newContext({ baseURL, serviceWorkers: 'block', viewport: { width: 390, height: 844 } });
  const guest = await guestContext.newPage();
  const username = `Voice${language}${Date.now()}`, temporary = 'voice-temporary-password-123', password = 'voice-fixture-password-123';
  const createdUser = await page.request.post('/api/admin/users', { headers, data: { username, temporary_password: temporary, role: 'user' } });
  expect(createdUser.status()).toBe(201);
  const initialLogin = await guest.request.post('/api/auth/login', { data: { username, password: temporary } });
  const initial = (await initialLogin.json()).user;
  const changed = await guest.request.post('/api/auth/change-password', { headers: { 'X-CSRF-Token': initial.csrf_token },
    data: { current_password: temporary, new_password: password } });
  expect(changed.ok()).toBeTruthy();
  const guestLogin = await guest.request.post('/api/auth/login', { data: { username, password } });
  expect(guestLogin.ok()).toBeTruthy();
  const buddy = (await guestLogin.json()).user;
  const guestLanguage = await guest.request.put('/api/auth/preferences/language', {
    headers: { 'X-CSRF-Token': buddy.csrf_token }, data: { preferred_language: language },
  });
  expect(guestLanguage.ok()).toBeTruthy();
  await installMedia(page, language); await installMedia(guest, language);

  let board, ownAudio = false, ownMicrophone = false, failJoin = false, nextMid = 1;
  const operations = [], routes = new Set(), subscribed = new Map();
  let roomId = `voice-test-${username}`;
  const members = () => (board?._participants || board?._players || []).filter(player => !player.is_cpu && player.user_id).map(player => ({
    user_id: player.user_id, player_id: player.id,
    audio: player.user_id === owner.id ? ownAudio : true,
    microphone: player.user_id === owner.id ? ownMicrophone : true, speaking: false,
  }));
  const voiceState = () => ({ event: 'state', available: true, room_id: roomId, members: members(),
    publications: members().filter(member => member.user_id !== owner.id).map(member => ({
      user_id: member.user_id, session_id: `remote-${member.user_id}`, track_name: 'microphone',
    })) });
  const broadcast = () => { for (const route of routes) route.send(JSON.stringify({ hausdepp_voice: voiceState() })); };
  if (mockVoice) await page.routeWebSocket(/\/ws\/[a-f0-9]{8}$/, route => {
    routes.add(route);
    const server = route.connectToServer();
    server.onMessage(raw => {
      let message;
      try { message = JSON.parse(String(raw)); } catch { /* Preserve unrelated frames. */ }
      if (message?.scoreboard) board = message.scoreboard;
      if (!message?.hausdepp_voice) route.send(raw);
      if (message?.scoreboard) broadcast();
    });
    route.onClose(() => { routes.delete(route); server.close(); });
    server.onClose((code, reason) => { routes.delete(route); route.close({ code, reason }); });
    route.onMessage(raw => {
      let message;
      try { message = JSON.parse(String(raw)); } catch { return server.send(raw); }
      if (message.action !== 'hausdepp_voice') return server.send(raw);
      operations.push(message);
      const reply = { request_id: message.request_id, ok: true };
      if (message.operation === 'join' && failJoin) Object.assign(reply, { ok: false, error_code: 'provider_unavailable' });
      else if (['join', 'resume'].includes(message.operation)) {
        if (message.operation === 'join') ownAudio = true;
        Object.assign(reply, { room_id: roomId, member_token: 'voice-test-member', session_id: 'voice-test-session', ice_servers: [], state: voiceState() });
      } else if (['state', 'heartbeat'].includes(message.operation)) reply.state = voiceState();
      else if (message.operation === 'publish') Object.assign(reply, { tracks: [{ mid: '0' }], sessionDescription: { type: 'answer', sdp: 'test-publish-answer' } });
      else if (message.operation === 'subscribe') {
        const tracks = message.user_ids.filter(id => !subscribed.has(id)).map(id => {
          const mid = String(nextMid++); subscribed.set(id, mid); return { user_id: id, mid };
        });
        for (const id of subscribed.keys()) if (!message.user_ids.includes(id)) subscribed.delete(id);
        Object.assign(reply, { tracks });
        if (tracks.length) Object.assign(reply, { requiresImmediateRenegotiation: true, sessionDescription: { type: 'offer', sdp: JSON.stringify(tracks.map(track => track.mid)) } });
      } else if (message.operation === 'microphone') ownMicrophone = message.enabled;
      else if (message.operation === 'leave') { ownAudio = ownMicrophone = false; subscribed.clear(); }
      route.send(JSON.stringify({ hausdepp_voice: reply }));
      if (['join', 'microphone', 'leave'].includes(message.operation)) broadcast();
    });
  });
  const created = await page.request.post('/api/games', { headers, data: { name: 'Voice UI · real table',
    game_type: 'hausdepp', mode: '2', play_mode: 'multiplayer', tournament: true } });
  expect(created.ok(), await created.text()).toBeTruthy();
  const gameId = (await created.json()).game_id, room = `/hausdepp/spiel/${gameId}`;
  await page.goto(room);
  await expect(page.locator('#hausdeppWaiting')).toBeVisible();
  if (mockVoice) await expect(page.locator('#hausdeppVoiceAudio')).toBeVisible();
  return {
    owner, buddy, guest, room, gameId, operations, get board() { return board; },
    setFailJoin(value) { failJoin = value; },
    changeRoom() { roomId += '-other-group'; broadcast(); },
    async start() {
      await guest.goto(room);
      try {
        await expect(guest.locator('#hausdeppTable')).toBeVisible();
        await expect(page.locator('#hausdeppTable')).toHaveAttribute('data-phase', /peeking|playing/);
      } catch (error) {
        const diagnostic = { guestUrl: guest.url(), guest: await guest.locator('body').innerText(),
          table: await (await page.request.get(`/api/games/${gameId}`)).json() };
        throw new Error(`${error.message}\nFixture diagnostic: ${JSON.stringify(diagnostic)}`);
      }
    },
    async cleanup() {
      await guestContext.close();
      await page.request.put('/api/auth/preferences/language', { headers, data: { preferred_language: originalLanguage } });
    },
  };
}

for (const language of ['de', 'en']) {
  test(`${language}: real table voice controls respect receive-only, microphone release and local mute`, async ({ page, browser, baseURL }, info) => {
    const app = await fixture(page, browser, baseURL, language);
    try {
      const output = page.locator('#hausdeppVoiceAudio'), mic = page.locator('#hausdeppVoiceMicrophone');
      const sound = page.locator('#hausdeppSound');
      const beta = page.locator('#hausdeppVoiceBeta');
      await expect(beta).toBeVisible();
      await expect(beta).toHaveText('Beta');
      await expect(beta).toHaveAttribute('title', language === 'de' ? 'Der Sprachchat ist eine Beta-Funktion.' : 'Voice chat is a beta feature.');
      await expect(page.locator('.hd-voice-controls')).toHaveAttribute('aria-describedby', 'hausdeppVoiceBetaDescription');
      await expect(page.locator('#hausdeppVoiceBetaDescription')).toHaveText(language === 'de' ? 'Der Sprachchat ist eine Beta-Funktion.' : 'Voice chat is a beta feature.');
      await expect(output).toHaveAttribute('aria-pressed', 'false');
      await expect(sound).toHaveAttribute('aria-pressed', 'false');
      await expect(sound).toHaveAccessibleName(language === 'de' ? 'Wirtshaus-Sound einschalten' : 'Turn tavern sound on');
      await sound.click();
      await expect(sound).toHaveAttribute('aria-pressed', 'true');
      expect(app.operations.filter(operation => operation.operation === 'join')).toHaveLength(0);
      expect(await page.evaluate(() => window.__voiceHarness.captures)).toBe(0);
      await expect(output).toHaveAccessibleName(language === 'de' ? 'Sprachchat hören' : 'Listen to voice chat');
      await expect(mic).toBeDisabled();
      await output.click();
      await expect(output).toHaveAttribute('aria-pressed', 'true');
      await expect(beta).toBeVisible();
      expect(await page.evaluate(() => window.__voiceHarness.captures)).toBe(0);
      await app.start();
      await expect(output).toHaveAttribute('aria-pressed', 'true');
      await expect(mic).toBeEnabled();
      await mic.click();
      await expect(mic).toHaveAttribute('aria-pressed', 'true');
      expect(await page.evaluate(() => window.__voiceHarness.captures)).toBe(1);
      await output.click();
      await expect(output).toHaveAttribute('aria-pressed', 'false');
      await expect(beta).toBeVisible();
      await expect(mic).toHaveAttribute('aria-pressed', 'false');
      await expect(mic).toBeDisabled();
      expect(await page.evaluate(() => window.__voiceHarness.tracks[0].readyState)).toBe('ended');
      await output.click();
      await expect(output).toHaveAttribute('aria-pressed', 'true');
      await expect(mic).toHaveAttribute('aria-pressed', 'false');
      expect(await page.evaluate(() => window.__voiceHarness.captures)).toBe(1);
      await page.locator('#hausdeppTools > summary').click();
      const mute = page.locator(`[data-voice-mute="${app.buddy.id}"]`);
      await expect(mute).toBeVisible();
      await mute.click(); await expect(mute).toHaveAttribute('aria-pressed', 'true');
      await expect(page.locator(`#hausdeppVoiceParticipants [data-voice-user="${app.buddy.id}"]`)).toContainText(language === 'de' ? 'Mikrofon an' : 'Microphone on');
      await expect(page.locator('.hd-voice-seat-status')).toHaveCount(1);
      if (await page.locator('#chatToggle').getAttribute('aria-expanded') === 'true') await page.locator('#chatToggle').click();
      if (language === 'de') {
        const screenshotDirectory = path.resolve(info.outputDir, '..', 'voice-review');
        await mkdir(screenshotDirectory, { recursive: true });
        for (const [width, height] of [[1440, 900], [390, 844]]) {
          await page.setViewportSize({ width, height });
          await page.locator('#hausdeppVoiceParticipants').scrollIntoViewIfNeeded();
          await page.screenshot({ path: path.join(screenshotDirectory, `voice-participants-${width}x${height}.png`) });
        }
      }
      await page.locator('#hausdeppTools .hd-tools-close').click();
      if (language === 'de') {
        const screenshotDirectory = path.resolve(info.outputDir, '..', 'voice-review');
        await mkdir(screenshotDirectory, { recursive: true });
        for (const [width, height] of [[1440, 900], [768, 1024], [390, 844], [320, 740], [844, 390]]) {
          await page.setViewportSize({ width, height });
          await page.evaluate(() => scrollTo(0, 0));
          const diagnostic = await output.evaluate(element => ({ body: document.body.className,
            bounds: element.getBoundingClientRect().toJSON(), toolbar: element.parentElement.outerHTML,
            ancestors: [element, element.parentElement, element.parentElement.parentElement, document.querySelector('#hausdeppHeader')]
              .map(node => ({ class: node.className, hidden: node.hidden, display: getComputedStyle(node).display,
                visibility: getComputedStyle(node).visibility, bounds: node.getBoundingClientRect().toJSON() })) }));
          await page.screenshot({ path: path.join(screenshotDirectory, `voice-${width}x${height}.png`) });
          await expect(output, JSON.stringify(diagnostic)).toBeInViewport(); await expect(mic).toBeInViewport(); await expect(beta).toBeInViewport();
          await expect(sound).toBeInViewport();
          const picker = page.locator('[data-game-picker]');
          await expect(picker).toBeInViewport({ ratio: 1 });
          if (width <= 480) {
            await expect(picker.locator('.suite-game-trigger__name')).toBeHidden();
            await expect(picker).toHaveAccessibleName(/Hausdepp/);
          } else {
            const pickerBounds = await picker.boundingBox(), nameBounds = await picker.locator('.suite-game-trigger__name').boundingBox();
            expect(nameBounds.x).toBeGreaterThanOrEqual(pickerBounds.x);
            expect(nameBounds.x + nameBounds.width).toBeLessThanOrEqual(pickerBounds.x + pickerBounds.width);
          }
          expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
        }
      }
      await mic.click(); await expect(mic).toHaveAttribute('aria-pressed', 'true');
      app.changeRoom();
      await expect(output).toHaveAttribute('aria-pressed', 'false');
      await expect(mic).toHaveAttribute('aria-pressed', 'false');
      expect(await page.evaluate(() => window.__voiceHarness.tracks.at(-1).readyState)).toBe('ended');
      await expect(sound).toHaveAttribute('aria-pressed', 'true');
      await sound.click(); await expect(sound).toHaveAttribute('aria-pressed', 'false');
    } finally { await app.cleanup(); }
  });
}

test('voice connection failure is visible and retry remains receive-only', async ({ page, browser, baseURL }) => {
  const app = await fixture(page, browser, baseURL);
  try {
    app.setFailJoin(true);
    await page.locator('#hausdeppVoiceAudio').click();
    const notice = page.locator('.hd-voice-notice');
    await expect(notice).toBeVisible();
    await expect(page.locator('#hausdeppVoiceMicrophone')).toBeDisabled();
    expect(await page.evaluate(() => window.__voiceHarness.captures)).toBe(0);
    app.setFailJoin(false); await notice.getByRole('button').click();
    await expect(page.locator('#hausdeppVoiceAudio')).toHaveAttribute('aria-pressed', 'true');
    await expect(notice).toBeHidden();
    await expect(page.locator('#hausdeppVoiceMicrophone')).toHaveAttribute('aria-pressed', 'false');
  } finally { await app.cleanup(); }
});

test('microphone denial preserves listening and the speaker toggle still turns audio off', async ({ page, browser, baseURL }) => {
  const app = await fixture(page, browser, baseURL);
  try {
    const output = page.locator('#hausdeppVoiceAudio'), mic = page.locator('#hausdeppVoiceMicrophone');
    await output.click(); await expect(output).toHaveAttribute('aria-pressed', 'true');
    await page.evaluate(() => { window.__voiceHarness.microphoneDenied = true; });
    await mic.click();
    await expect(page.locator('.hd-voice-notice')).toBeVisible();
    await expect(output).toHaveAttribute('aria-pressed', 'true');
    await expect(mic).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('.hd-voice-notice button')).toHaveCount(0);
    await output.click();
    await expect(output).toHaveAttribute('aria-pressed', 'false');
    await expect(mic).toBeDisabled();
    expect(await page.evaluate(() => window.__voiceHarness.tracks.length)).toBe(0);
  } finally { await app.cleanup(); }
});

test('real backend without configured voice service hides the voice toolbar', async ({ page, browser, baseURL }) => {
  const app = await fixture(page, browser, baseURL, 'de', { mockVoice: false });
  try {
    await app.start();
    await expect(page.locator('#hausdeppVoiceAudio')).toBeHidden();
    await expect(page.locator('#hausdeppVoiceMicrophone')).toBeHidden();
    await expect(page.locator('#hausdeppVoiceBeta')).toBeHidden();
    await expect(page.locator('#hausdeppSound')).toBeVisible();
    expect(await page.evaluate(() => window.__voiceHarness.captures)).toBe(0);
    expect(await page.evaluate(() => window.__voiceHarness.peers.length)).toBe(0);
  } finally { await app.cleanup(); }
});

test('actual end-game and create-again preserve the in-document voice controller and microphone', async ({ page, browser, baseURL }) => {
  const app = await fixture(page, browser, baseURL);
  try {
    await app.start(); await page.locator('#hausdeppVoiceAudio').click();
    await page.locator('#hausdeppSound').click();
    await expect(page.locator('#hausdeppSound')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('#hausdeppVoiceMicrophone').click();
    await expect(page.locator('#hausdeppVoiceMicrophone')).toHaveAttribute('aria-pressed', 'true');
    const token = await page.evaluate(() => { window.__voiceDocumentToken = crypto.randomUUID(); return window.__voiceDocumentToken; });
    await page.evaluate(() => window.__voiceGameSocket.send(JSON.stringify({ action: 'end_game' })));
    await expect(page.locator('#hausdeppRecreate')).toBeVisible();
    await expect(page.locator('#hausdeppVoiceAudio')).toBeVisible();
    await expect(page.locator('#hausdeppVoiceMicrophone')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('#hausdeppRecreate').click();
    await expect(page).toHaveURL(url => url.pathname.startsWith('/hausdepp/spiel/') && url.pathname !== app.room);
    await expect(page.locator('#hausdeppWaiting')).toBeVisible();
    await expect(page.locator('#hausdeppVoiceMicrophone')).toHaveAttribute('aria-pressed', 'true');
    expect(await page.evaluate(() => window.__voiceDocumentToken)).toBe(token);
    await expect(page.locator('#hausdeppSound')).toHaveAttribute('aria-pressed', 'true');
    expect(await page.evaluate(() => window.__voiceHarness.peers.length)).toBe(1);
    expect(await page.evaluate(() => window.__voiceHarness.tracks[0].readyState)).toBe('live');
    expect(app.operations.filter(operation => operation.operation === 'join')).toHaveLength(1);
    expect(app.operations.some(operation => operation.operation === 'resume')).toBe(true);
  } finally { await app.cleanup(); }
});

test('guests and authenticated spectators have no voice or local sound controls', async ({ page, browser, baseURL }) => {
  const app = await fixture(page, browser, baseURL);
  const visitorContext = await browser.newContext({ baseURL, serviceWorkers: 'block' });
  try {
    await app.start();
    const visitor = await visitorContext.newPage(); await visitor.goto('/hausdepp');
    await expect(visitor.locator('#hausdeppSignIn')).toBeVisible();
    await expect(visitor.locator('#hausdeppVoiceAudio')).toHaveCount(0);
    await expect(visitor.locator('#hausdeppSound')).toHaveCount(0);
    const loggedIn = await visitor.request.post('/api/auth/login', { data: { username: 'Admin', password: 'temporary-password-123' } });
    expect(loggedIn.ok()).toBeTruthy();
    await installMedia(visitor, 'de'); await visitor.goto(`${app.room}/zuschauen`);
    await expect(visitor.locator('#hausdeppTable')).toBeVisible();
    await expect(visitor.locator('#hausdeppVoiceAudio')).toHaveCount(0);
    await expect(visitor.locator('#hausdeppVoiceMicrophone')).toHaveCount(0);
    await expect(visitor.locator('#hausdeppSound')).toHaveCount(0);
    expect(await visitor.evaluate(() => window.__voiceHarness.captures)).toBe(0);
  } finally { await visitorContext.close(); await app.cleanup(); }
});

test('a real CPU table offers local sound without joining voice or capturing a microphone', async ({ page }) => {
  const login = await page.request.post('/api/auth/login', { data: { username: 'Admin', password: 'temporary-password-123' } });
  expect(login.ok()).toBeTruthy();
  const owner = (await login.json()).user;
  await installMedia(page, 'de');
  const created = await page.request.post('/api/games', {
    headers: { 'X-CSRF-Token': owner.csrf_token },
    data: { name: 'Local sound · CPU table', game_type: 'hausdepp', mode: '2', play_mode: 'cpu', cpu_count: 1 },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const gameId = (await created.json()).game_id;
  await page.goto(`/hausdepp/spiel/${gameId}`);
  await expect(page.locator('#hausdeppTable')).toHaveAttribute('data-phase', /peeking|playing/);
  const sound = page.locator('#hausdeppSound');
  await expect(sound).toBeVisible();
  await expect(sound).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#hausdeppVoiceAudio')).toBeHidden();
  await sound.click(); await expect(sound).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => window.__voiceHarness.captures)).toBe(0);
  expect(await page.evaluate(() => window.__voiceHarness.peers.length)).toBe(0);
  for (const [width, height] of [[390, 844], [320, 740]]) {
    await page.setViewportSize({ width, height });
    await expect(sound).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  }
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await expect(sound).toHaveCount(0);
});
