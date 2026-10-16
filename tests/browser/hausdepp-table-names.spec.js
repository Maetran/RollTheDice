const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');

const source = fs.readFileSync(path.join(__dirname, '../../frontend/hausdepp/table-names.js'), 'utf8');
const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;

async function withCrypto(provider, run) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: provider });
  try { return await run(); }
  finally {
    if (original) Object.defineProperty(globalThis, 'crypto', original);
    else delete globalThis.crypto;
  }
}

test('fifty paired table names remain distinct and fully translated', async () => {
  const { HOUSE_TABLE_NAME_TEMPLATES, generateHouseTableName, generateTableName } = await import(moduleUrl);
  expect(HOUSE_TABLE_NAME_TEMPLATES).toHaveLength(50);
  expect(generateTableName).toBe(generateHouseTableName);
  for (const language of ['de', 'en']) {
    const titles = [];
    for (let index = 0; index < 50; index += 1) {
      titles.push(await withCrypto({ getRandomValues: sample => { sample[0] = index; return sample; } },
        () => generateHouseTableName('Mani', language)));
    }
    expect(new Set(titles).size).toBe(50);
    expect(titles.every(title => title.includes('Mani') && !/[{}]/u.test(title))).toBe(true);
    expect(titles[0]).toBe(language === 'de' ? 'Manis Gsuff' : 'Mani’s nightcap');
    expect(Object.isFrozen(HOUSE_TABLE_NAME_TEMPLATES)).toBe(true);
    expect(HOUSE_TABLE_NAME_TEMPLATES.every(template => Object.isFrozen(template) && template.de && template.en)).toBe(true);
  }
});

test('German possessives and English counterparts keep the original owner', async () => {
  const { generateHouseTableName } = await import(moduleUrl);
  await withCrypto({ getRandomValues: sample => { sample[0] = 1; return sample; } }, () => {
    for (const name of ['Markus', 'Felix', 'Fritz', 'Groß', 'HANS']) {
      expect(generateHouseTableName(name, 'de')).toBe(`${name}’ Kartenecke`);
    }
    expect(generateHouseTableName('Mani', 'de')).toBe('Manis Kartenecke');
    expect(generateHouseTableName('Markus', 'en')).toBe('Markus’ card corner');
    expect(generateHouseTableName('Felix', 'en-US')).toBe('Felix’s card corner');
    expect(generateHouseTableName('<Mani>', 'de')).toBe('<Mani>s Kartenecke');
  });
});

test('long and Unicode usernames fit the80-character API limit before owner truncation', async () => {
  const { generateHouseTableName } = await import(moduleUrl);
  for (const name of ['M'.repeat(64), '🂺'.repeat(64), 'a\u0308'.repeat(64)]) {
    for (const language of ['de', 'en']) {
      for (let index = 0; index < 50; index += 1) {
        const title = await withCrypto({ getRandomValues: sample => { sample[0] = index; return sample; } },
          () => generateHouseTableName(name, language));
        expect(Array.from(title).length).toBeLessThanOrEqual(80);
        expect(title).toContain(name.normalize('NFC'));
      }
    }
  }
  const huge = generateHouseTableName('🂺'.repeat(100), 'de');
  expect(Array.from(huge)).toHaveLength(80);
  expect(huge.endsWith('…')).toBe(true);
});

test('random rejection and blocked crypto still produce valid titles without blocking creation', async () => {
  const { generateHouseTableName } = await import(moduleUrl);
  let calls = 0;
  const title = await withCrypto({ getRandomValues: sample => {
    sample[0] = calls++ === 0 ? 2 ** 32 - 1 : 49;
    return sample;
  } }, () => generateHouseTableName('Mani', 'de'));
  expect(calls).toBe(2);
  expect(title).toBe('Auf einen Zehner mit Mani');
  const originalRandom = Math.random;
  Math.random = () => 0.4;
  try {
    expect(await withCrypto({ getRandomValues: () => { throw new Error('blocked'); } },
      () => generateHouseTableName('Mani', 'de'))).toBe('Manis Hausrunde');
    let attempts = 0;
    await withCrypto({ getRandomValues: sample => { attempts += 1; sample[0] = 2 ** 32 - 1; return sample; } },
      () => generateHouseTableName('Mani', 'de'));
    expect(attempts).toBe(8);
    Math.random = () => Number.NaN;
    expect(await withCrypto(null, () => generateHouseTableName('', 'en'))).toBe('Guest’s nightcap');
  } finally { Math.random = originalRandom; }
});
