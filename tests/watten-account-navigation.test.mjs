import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const navigation = await readFile(new URL('../frontend/shared/account-navigation.js', import.meta.url), 'utf8');
const account = await readFile(new URL('../frontend/watten/account.js', import.meta.url), 'utf8');
const progress = await readFile(new URL('../frontend/watten/progress.js', import.meta.url), 'utf8');
const hausdepp = await readFile(new URL('../frontend/hausdepp/settings.js', import.meta.url), 'utf8');
const catalog = await readFile(new URL('../frontend/i18n/catalog.js', import.meta.url), 'utf8');
const between = (source, start, end) => {
  const from = source.indexOf(start), until = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && until > from, `source boundaries: ${start} / ${end}`);
  return source.slice(from, until);
};
const shared = navigation.replace(/^import .*;$/gm, '').replace(/export function /g, 'function ');
const settings = `${between(account, 'function renderSettings(auth) {', '  openAccountSettingTarget(root);')}}`;
const mountedSettings = between(account, 'function renderSettings(auth) {', "\nif (page === 'home')");
const hausdeppSettings = `${between(hausdepp, 'const t = text', '  // A link to a setting,').replace('export function ', 'function ')}}`;
const progressNavigation = between(progress, 'function navigation() {', '\nfunction shell(');
const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);
const english = runInNewContext(`${catalog.replace(/^export const /gm, 'const ')}\nEN;`);
const translate = language => value => language === 'en' ? english[value] || value : value;
const currentLinks = html => [...html.matchAll(/<a\b[^>]*aria-current="page"[^>]*>/g)].map(match => match[0]);

function renderSettings(auth, language, mount = false) {
  const element = { elements: { language: {} }, addEventListener() {}, querySelector() { return element; } };
  const root = { innerHTML: '', querySelector: () => element }, modes = [], releases = [], tours = [];
  const t = translate(language);
  runInNewContext(`${shared}\nlet viewerId = null, voicePreferences, friendSettings, pushSettings; const generation = 1, navigating = false;\n${mount ? mountedSettings : settings}\nrenderSettings(auth);`, {
    auth, root, location: { hash: '' }, document: { documentElement: { lang: language } }, escapeHtml, esc: escapeHtml, t, copy: value => escapeHtml(t(value)),
    window: { ZDWA_I18N: { t } }, clearPushSettings() {}, clearVoicePreferences() {},
    initializeAppMode: mode => modes.push(mode.mode), voicePreferenceText: value => value,
    friendSettingsText: value => value, pushSettingsMarkup: () => '<div data-watten-push-settings></div>',
    mountUsernameSettings() {}, mountTourSettings: () => tours.push('tour'), mountPasskeySettings() {}, mountEmailSettings() {},
    mountAvatarUpload() {}, clearFriendSettings() {}, mountAccountMergeNotice() {}, mountVoicePreferences() {},
    mountFriendSettings() {}, mountWattenPushSettings() {}, mountAccountVerification() {}, loadAuth() {},
    initializeReleaseNotes: options => releases.push(options.context),
  });
  return { html: root.innerHTML, modes, releases, tours };
}

for (const language of ['de', 'en']) {
  test(`Watten ${language}: account-only settings omit locked progress links and retain every settings group`, () => {
    for (const game_access of [undefined, {}, { watten_preview: false, watten_public: false }, { watten_preview: 'true' }]) {
      const { html, modes } = renderSettings({ user: { id: 1, username: '<private>' }, game_access }, language);
      assert.doesNotMatch(html, /href="\/watten\/konto\/fortschritt/);
      assert.equal((html.match(/data-account-destination=/g) || []).length, 1);
      assert.deepEqual(currentLinks(html), ['<a href="/watten/konto/einstellungen" data-account-destination="settings" aria-current="page">']);
      assert.match(html, new RegExp(`>${language === 'de' ? 'Einstellungen' : 'Settings'}</a>`));
      assert.deepEqual(modes, []);
      for (const group of ['access', 'play', 'social', 'help']) assert.match(html, new RegExp(`data-account-section="${group}"`));
      for (const control of ['data-password', 'data-language', 'data-passkey-settings', 'data-avatar-upload', 'data-voice-preference-settings', 'data-watten-friend-settings', 'data-game-tour-settings']) {
        assert.match(html, new RegExp(control));
      }
      assert.match(html, /&lt;private&gt;/);
      assert.doesNotMatch(html, /data-watten-push-settings/);
    }
  });

  test(`Watten ${language}: existing strict public/preview flags preserve the complete navigation`, () => {
    for (const game_access of [{ watten_preview: true }, { watten_public: true }]) {
      const { html, modes } = renderSettings({ user: { id: 1, username: 'Player' }, game_access }, language);
      assert.equal((html.match(/href="\/watten\/konto\/fortschritt/g) || []).length, 3);
      assert.equal((html.match(/data-account-destination=/g) || []).length, 3);
      assert.equal(currentLinks(html).length, 1);
      assert.deepEqual(modes, ['watten']);
      assert.equal(html.includes('data-watten-push-settings'), game_access.watten_public === true);
    }
    const user = { id: 1, username: 'Player', game_access: { watten_preview: true } };
    assert.match(renderSettings({ user }, language).html, /href="\/watten\/konto\/fortschritt/);
    assert.doesNotMatch(renderSettings({ user, game_access: {} }, language).html, /href="\/watten\/konto\/fortschritt/);
  });

  test(`Watten ${language}: history has one current destination while statistics and achievements retain their deep links`, () => {
    for (const hash of ['', '#statistics', '#achievements']) {
      const t = translate(language);
      const context = { page: 'history', location: { hash }, window: { ZDWA_I18N: { t } }, escapeHtml, esc: escapeHtml, t };
      const html = runInNewContext(`${shared}\n${progressNavigation}\nnavigation();`, context);
      assert.deepEqual(currentLinks(html), ['<a href="/watten/konto/verlauf" aria-current="page">']);
      assert.equal((html.match(/data-account-destination=/g) || []).length, 3);
      for (const section of ['statistics', 'achievements']) assert.match(html, new RegExp(`href="/watten/konto/fortschritt#${section}"`));
      const active = runInNewContext(`${shared}\n${progressNavigation}\nnavigation();`, { ...context, page: 'progress' });
      assert.equal(currentLinks(active).length, 1);
      assert.match(currentLinks(active)[0], new RegExp(`data-account-destination="${hash === '#achievements' ? 'achievements' : 'statistics'}"`));
    }
  });

  test(`Watten ${language}: real settings mount never starts release polling without play access and keeps help available`, () => {
    for (const game_access of [{}, { watten_preview: false, watten_public: false }, { watten_preview: 'true' }, { watten_preview: true }, { watten_public: true }]) {
      const canPlay = game_access.watten_preview === true || game_access.watten_public === true;
      const { html, releases, tours } = renderSettings({ user: { id: 1, username: 'Player' }, game_access }, language, true);
      assert.deepEqual(releases, canPlay ? ['watten'] : []);
      assert.equal(html.includes('data-release-history'), canPlay);
      assert.deepEqual(tours, ['tour']);
      for (const destination of ['issues', 'changelog']) assert.match(html, new RegExp(`href="/go/github/${destination}" target="_blank" rel="noopener noreferrer"`));
      assert.match(html, new RegExp(escapeHtml(translate(language)('Hilfe & weitere Details'))));
    }
  });

  test(`Hausdepp ${language}: help exposes separate tours and release rows plus existing translated support links`, () => {
    const root = { innerHTML: '' }, t = translate(language);
    runInNewContext(`${shared}\n${hausdeppSettings}\nrenderAccountSettings(root, { user: { id: 1, username: 'Player' } });`, {
      root, document: {}, window: { ZDWA_I18N: { t } }, escapeHtml, esc: escapeHtml, avatarMarkup: () => '', voicePreferenceText: value => value,
    });
    const help = root.innerHTML.slice(root.innerHTML.indexOf('data-account-section="help"'));
    const headings = [...help.matchAll(/<strong>(.*?)<\/strong>/g)].map(match => match[1]);
    assert.deepEqual(headings, [escapeHtml(t('Einsteigertouren')), escapeHtml(t('Neuigkeiten & Versionen'))]);
    assert.match(help, /data-game-tour-settings/);
    assert.match(help, /data-release-history/);
    for (const destination of ['issues', 'changelog']) assert.match(help, new RegExp(`href="/go/github/${destination}" target="_blank" rel="noopener noreferrer"`));
    for (const label of ['Hilfe & weitere Details', 'Problem auf GitHub melden', 'Ausführliche Versionshistorie auf GitHub']) assert.match(help, new RegExp(escapeHtml(t(label))));
  });
}
