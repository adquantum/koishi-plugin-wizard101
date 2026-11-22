'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { LocalCatalog, normalizeFilters } = require('../lib/catalog.cjs');
const { LocaleDictionary } = require('../lib/locale.cjs');
const { BotController } = require('../lib/bot-controller.cjs');
const views = require('../lib/views.cjs');
const { textCost, neutralizeMentions } = require('../lib/platform.cjs');

function pack(entries) { return { kind: 'wizard101.catalog', schemaVersion: 1, source: { name: 'Synthetic fixture', synthetic: true }, entries }; }
function entries() { return [
  { type: 'item', id: '4611686020152371460', name: 'Ember Hat', zh: '餘燼帽', school: 'fire', kind: 'hat', level: 170 },
  { type: 'item', id: '2', name: 'Ember Boots', school: 'ice', kind: 'shoes', level: 160 },
  { type: 'pet', id: '3', name: 'Fixture Pet', school: 'fire', wow_factor: 0, exclusive: false },
  { type: 'pet', id: '4', name: 'Unknown Wow', school: 'fire', wow_factor: null },
  { type: 'fish', id: '5', name: 'Sentinel', school: 'ice', rank: 2, is_sentinel: true },
]; }
test('catalog preserves IDs and filters actual typed fields without treating absent values as zero', () => {
  const c = new LocalCatalog(pack(entries()));
  assert.equal(c.get('item', '4611686020152371460').name, 'Ember Hat');
  assert.equal(c.search('装备', '余烬帽', { school: '火焰', kind: '帽子', level: 170 }).total, 1);
  assert.equal(c.search('pet', [], { wow: 0 }).total, 1);
  assert.equal(c.search('pet', [], { exclusive: 'false' }).total, 1);
  assert.equal(c.search('fish', [], { sentinel: 'false' }).total, 0);
  assert.equal(c.search('fish', [], { sentinel: true, school: '寒冰', rank: 2 }).total, 1);
  assert.throws(() => normalizeFilters({ school: 'unknown-school' }), /学派/);
  assert.throws(() => normalizeFilters({ rank: Infinity }), /有限/);
});
test('catalog refuses duplicate identities, ambiguous formats, unsafe IDs and malicious properties', () => {
  assert.throws(() => new LocalCatalog({ schemaVersion: 1, entries: [] }), /wizard101.catalog/);
  assert.throws(() => new LocalCatalog(pack([entries()[0], entries()[0]])), /重复/);
  assert.throws(() => new LocalCatalog(pack([{ type: 'item', id: Number.MAX_SAFE_INTEGER + 2, name: 'Bad' }])), /精度/);
  const pollution = JSON.parse('{"type":"item","id":"1","name":"Bad","__proto__":{"polluted":true}}');
  assert.throws(() => new LocalCatalog(pack([pollution])), /不允许/);
  assert.equal({}.polluted, undefined);
});
test('gzip catalogs parse unsafe integer tokens losslessly and reject credential-bearing source URLs', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wiz-catalog-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'pack.gz');
  const raw = '{"kind":"wizard101.catalog","schemaVersion":1,"source":{"url":"https://user:secret@example.com/data"},"entries":[{"type":"item","id":4611686020152371460,"name":"Big ID"}]}';
  await fs.writeFile(file, zlib.gzipSync(raw));
  const c = await LocalCatalog.load(file);
  assert.equal(c.get('item', '4611686020152371460').id, '4611686020152371460');
  assert.equal(c.source.url, undefined);
});
test('local result ordering, paging and disposal have deterministic boundaries', () => {
  const c = new LocalCatalog(pack(entries()));
  const one = c.search('item', 'Ember', {}, 1, 1);
  const two = c.search('item', 'Ember', {}, 2, 1);
  assert.equal(one.totalPages, 2);
  assert.notEqual(one.items[0].id, two.items[0].id);
  assert.equal(two.nextPage, null);
  c.dispose();
  assert.equal(c.stats().entries, 0);
});
test('structured detail pages retain long descriptions, source and explicit units', () => {
  const dict = { translate: value => ({ text: value, translated: false }) };
  const description = '说明'.repeat(3500) + 'END_OF_DESCRIPTION';
  const reply = views.detailReply('item', '1', { name: 'Synthetic', description, stats: { damage: 20, damage_percent: 30 }, api_key: 'should-not-display' }, dict, { source: 'Synthetic fixture', synthetic: true });
  const text = reply.pages.map(p => p.text).join('\n');
  assert.ok(reply.pages.length > 1);
  assert.match(text, /END_OF_DESCRIPTION/);
  assert.match(text, /伤害：20(?:\n|$)/);
  assert.match(text, /伤害加成：30%/);
  assert.doesNotMatch(text, /should-not-display/);
  assert.ok(reply.pages.every(p => p.text.includes('Synthetic fixture')));
});
test('pet and socket rows resolve to actual semantic icon keys', () => {
  const rows = views.entityRows({ name: 'Synthetic', strength: 250, sockets: [{ shape: 'circle', locked: true }] }, { translate: v => ({ text: v }) });
  assert.ok(rows.some(r => r.icon === 'pet.strength'));
  assert.ok(rows.some(r => r.icon === 'socket.circle.locked'));
});
test('named array entries retain priority, descriptions, flags and equipped socket fields', () => {
  const rows = views.entityRows({
    talents: [{ id: '1', name: 'Talent', priority: 23 }],
    maycasts: [{ id: '2', name: 'Maycast', description: 'Kept description', unresolved: true }],
    sockets: [{ shape: 'circle', locked: false, jewel: { id: '3', name: 'Inserted jewel' } }],
  }, { translate: v => ({ text: v }) });
  const text = rows.map(r => `${r.label}: ${r.value}`).join('\n');
  assert.match(text, /优先级: 23/);
  assert.match(text, /Kept description/);
  assert.match(text, /尚未解析: 是/);
  assert.match(text, /Inserted jewel/);
});
test('API relationships preserve long mechanics and all visible cards without inventing counts', async () => {
  const dict = new LocaleDictionary({ schemaVersion: 1, source: {}, stats: {}, files: [], entries: [] });
  const api = {
    async relation(id, type) {
      const data = type === 'cheats' ? { markdown: '规则'.repeat(3000) + 'MECHANICS_TAIL' }
        : type === 'deck' ? { cards: Array.from({ length: 45 }, (_, i) => ({ name: `Card-${i}`, id: String(i + 1), ...(i === 0 ? { count: 0 } : {}) })) }
          : { loot_table_groups: [{ name: 'Unresolved table', is_resolved: false }] };
      return { body: { data }, fetchedAt: 0, cacheHit: true };
    }, dispose() {},
  };
  const service = new BotController({ command: 'wiz', pageSize: 2 }, dict, api);
  const cheats = await service.relation('1', 'cheats');
  assert.match(cheats.pages.map(p => p.text).join(''), /MECHANICS_TAIL/);
  const deck = await service.relation('1', 'deck');
  const text = deck.pages.map(p => p.text).join('\n');
  assert.match(text, /Card-44/);
  assert.match(text, /Card-0 \[1\] ×0/);
  assert.match(text, /Card-1 \[2\] ×未提供张数/);
  assert.ok(deck.pages.every(p => p.text.includes('Wizard404（缓存）')));
  const drops = await service.relation('1', 'drops');
  assert.match(drops.pages.map(p => p.text).join('\n'), /有 1 张掉落表尚未解析/);
  assert.match(drops.pages.map(p => p.text).join('\n'), /是否已解析：否/);
  service.dispose();
});
test('equipment comparisons paginate beyond the legacy 24 fields and mark the actual source', () => {
  const stats = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`attribute${i}`, i]));
  const dict = { translate: v => ({ text: v }) };
  const reply = views.compareReply('1', { name: 'One', stats }, '2', { name: 'Two', stats: { ...stats, absent_on_a: 10 } }, dict, { source: 'Synthetic fixture', synthetic: true });
  const text = reply.pages.map(p => p.text).join('\n');
  assert.match(text, /attribute39：39 → 39/);
  assert.doesNotMatch(text, /absent_on_a|来源：Wizard404/);
  assert.ok(reply.pages.every(p => p.text.includes('合成示例')));
});
test('transport pagination retains hostile Markdown and emoji instead of sending an unreachable tail', () => {
  const dict = new LocaleDictionary({ schemaVersion: 1, source: {}, stats: {}, files: [], entries: [] });
  const api = { stats: () => ({}), dispose() {} };
  const service = new BotController({ command: 'wiz', pageSize: 2, cooldownMs: 0 }, dict, api);
  const session = { platform: 'discord', userId: 'a', channelId: 'b' };
  const input = '*_😀'.repeat(1600) + 'THE_LAST_TEXT';
  service.prepareReply(session, input);
  const state = service.responses.values().next().value;
  assert.match(state.pages.map(p => p.text).join(''), /THE_LAST_TEXT$/);
  for (let i = 1; i <= state.pages.length; i++) {
    const text = service.responsePage(session, i).text;
    assert.ok(textCost(neutralizeMentions(text, 'discord'), 'discord') <= 1800);
  }
  assert.match(service.responsePage({ ...session, userId: 'else' }, 1).text, /没有当前详情/);
  service.dispose();
});

test('local-only zone lookup never calls the network and keeps object-name case significant', async () => {
  const dict = new LocaleDictionary({ schemaVersion: 1, source: {}, stats: {}, files: [], entries: [] });
  const api = { lookupZone() { throw new Error('Network must not be used'); }, dispose() {} };
  const catalog = new LocalCatalog(pack([{ type: 'zone', id: '1', name: 'Synthetic Zone', object_name: 'World/Area' }]));
  const service = new BotController({ command: 'wiz', pageSize: 2, dataSource: 'local' }, dict, api, catalog);
  const found = await service.lookup('World/Area');
  assert.match(found.pages[0].text, /Synthetic Zone/);
  assert.match(await service.lookup('world/area'), /没有完全匹配/);
  service.catalog.dispose();
  assert.match(await service.lookup('World/Area'), /尚未导入/);
  service.dispose();
});

test('explicit remote search keeps its source through selection and list navigation', async () => {
  const dict = new LocaleDictionary({ schemaVersion: 1, source: {}, stats: {}, files: [], entries: [] });
  const catalog = new LocalCatalog(pack([{ type: 'item', id: '1', name: 'Target Local', stats: { health: 100 } }]));
  const api = {
    async search(type, query, page) { return { body: { data: [{ id: String(page), name: 'Target Remote' }], next_page: page === 1 ? 2 : null }, fetchedAt: 0, cacheHit: false }; },
    async detail(type, id) { return { body: { id, name: 'Target Remote', stats: { health: 999 } }, fetchedAt: 0, cacheHit: false }; }, dispose() {},
  };
  const service = new BotController({ command: 'wiz', pageSize: 2, onlineSearchEnabled: true, dataSource: 'hybrid' }, dict, api, catalog);
  const session = { platform: 'discord', channelId: 'a', userId: 'b' };
  await service.search(session, 'Target', 'item', 1, { remote: true });
  await service.next(session);
  await service.navigate(session, 'prev');
  const selected = await service.pick(session, 1);
  const text = selected.pages.map(p => p.text).join('\n');
  assert.match(text, /Target Remote/);
  assert.match(text, /999/);
  assert.match(text, /来源：Wizard404/);
  assert.doesNotMatch(text, /Target Local/);
  service.dispose();
});
