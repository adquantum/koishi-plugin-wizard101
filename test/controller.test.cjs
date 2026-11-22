'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { WikiController } = require('../lib/controller.cjs');
const { LocaleDictionary } = require('../lib/locale.cjs');
const { scrub, argumentsOf } = require('../tools/probe-api.cjs');
const format = require('../lib/format.cjs');

const session = { platform: 'test', selfId: 'bot', userId: 'alice', channelId: 'one' };
function setup() {
  const dict = new LocaleDictionary({ schemaVersion: 1, files: [{ path: 'Locale/Spells.lang', table: 'Spells' }], entries: [
    [0, '1', 'Fire Cat', '火猫'], [0, '2', 'Golden Piggle', '火猫'], [0, '3', 'MooShu', '木须'],
  ] }, { convert: x => x });
  const calls = [];
  const api = {
    async search(type, query, page) {
      calls.push({ type, query, page });
      return { body: { success: true, data: [{ template_id: '1', name: 'Fire Cat' }, { template_id: '2', name: 'Snow Serpent' }], pagination: { page, next_page: page + 1 } }, fetchedAt: Date.now(), cacheHit: false };
    },
    dispose() {}, stats() { return { cacheEntries: 0 }; },
  };
  const controller = new WikiController({ command: 'wiz', defaultType: 'item', pageSize: 8, onlineSearchEnabled: true, cooldownMs: 0 }, dict, api);
  return { dict, calls, controller };
}

test('ambiguous Chinese names make no network request until a candidate is selected', async () => {
  const { calls, controller } = setup();
  const choices = await controller.search(session, '火猫', 'spell');
  assert.match(choices, /Fire Cat/);
  assert.match(choices, /Golden Piggle/);
  assert.equal(calls.length, 0);
  await controller.pick(session, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].type, 'spell');
  controller.dispose();
});

test('Chinese fuzzy suggestions never silently turn into guessed online queries', async () => {
  const { calls, controller } = setup();
  const reply = await controller.search(session, '火', 'spell');
  assert.match(reply, /没有确定的英文/);
  assert.equal(calls.length, 0);
  controller.dispose();
});

test('ignored search filters cannot present unrelated items as positive hits', async () => {
  const { controller } = setup();
  const reply = await controller.search(session, 'Fire Cat', 'spell');
  assert.match(reply, /Fire Cat/);
  assert.doesNotMatch(reply, /Snow Serpent/);
  assert.match(reply, /排除 1/);
  controller.dispose();
});

test('identical server pages stop pagination rather than looping forever', async () => {
  const { calls, controller } = setup();
  await controller.search(session, 'Fire Cat', 'spell');
  assert.match(await controller.next(session), /重复页面/);
  await controller.next(session);
  assert.equal(calls.length, 2);
  controller.dispose();
});

test('translated labels retain raw keys for school values and preserve untrusted plain text', () => {
  const { dict } = setup();
  const rows = format.flattenFields({ school: 'Fire', nested: { name: 'MooShu' }, description: '<at type="all"/>' }, dict);
  assert.match(rows.join('\n'), /火焰 \(Fire\)/);
  assert.match(rows.join('\n'), /木须 \/ MooShu/);
  assert.match(rows.join('\n'), /<at type="all"\/>/);
  dict.dispose();
});

test('comparison never substitutes missing stats with zero or combines differently named fields', () => {
  const { dict } = setup();
  const result = format.compare('1', { name: 'A', stats: { damage: 10, resist: 5 } }, '2', { name: 'B', stats: { damage: 12, resistance: 8 } }, dict);
  assert.match(result, /damage：10 → 12/);
  assert.doesNotMatch(result, /resist：/);
  assert.match(format.compare('1', { name: 'A' }, '2', { name: 'B', stats: { damage: 9 } }, dict), /不把缺失值当作 0/);
  dict.dispose();
});

test('empty drops and missing cheat text do not imply absence of drops or mechanics', () => {
  const { dict } = setup();
  assert.match(format.relation('1', 'drops', { loot_entries: [], loot_table_groups: [{ is_resolved: false }], second_chance_chests: [] }, {}, dict), /尚未解析/);
  assert.match(format.relation('1', 'drops', { loot_entries: [] }, {}, dict), /尚无已知记录/);
  assert.match(format.relation('1', 'cheats', { markdown: '' }, {}, dict), /不代表此怪物没有/);
  dict.dispose();
});

test('source link and cache timestamp survive bounded long detail rendering', () => {
  const { dict } = setup();
  const value = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`field${i}`, 'x'.repeat(500)]));
  const text = format.detail('quest', '4611686020152371460', { name: 'Long', ...value }, { cacheHit: true, fetchedAt: 1700000000000 }, dict, 'wiz');
  assert.ok(text.length <= 3500);
  assert.match(text, /https:\/\/wizard404.com\/quest\/4611686020152371460$/);
  assert.match(text, /缓存/);
  dict.dispose();
});

test('probe scrubs nested credentials and never accepts command-line API keys', () => {
  const cleaned = scrub({ authorization: 'Bearer secret-123', data: ['secret-123', 'w404_dev_thisIsNotARealKey'], apiKey: 'anything' }, 'secret-123');
  assert.doesNotMatch(JSON.stringify(cleaned), /secret-123|thisIsNotARealKey|anything/);
  assert.throws(() => argumentsOf(['--api-key', 'secret-123']), /未知/);
  assert.equal(argumentsOf(['--type', 'spell', '--query', 'Fire Cat']).query, 'Fire Cat');
});
