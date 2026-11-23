'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { LocalCatalog } = require('../lib/catalog.cjs');
const { LocaleDictionary } = require('../lib/locale.cjs');
const { KimerithSearch, ratio } = require('../lib/kimerith-search.cjs');
const { KimerithController, ROUTES } = require('../lib/kimerith-controller.cjs');
const { aggregateMobStats, calculateKimerithMobDamage } = require('../lib/kimerith-math.cjs');
const { PortraitStore } = require('../lib/portraits.cjs');
const { CardRenderer, createCardSvg } = require('../lib/cards.cjs');
const { neutralizeMentions, textCost } = require('../lib/platform.cjs');
const views = require('../lib/kimerith-views.cjs');

const REVISION = '3c24847d111387fc0b34772b548f74e80089599f';
const BIG = '4611686020152371460';
const session = { platform: 'discord', selfId: 'bot', userId: 'owner', channelId: 'room' };

function setup(extra = []) {
  const dict = new LocaleDictionary({ schemaVersion: 1, source: {}, stats: {}, files: [{ path: 'Fixture.lang', table: 'Fixture' }], entries: [[0, 'hat', 'Ember Hat', '余烬帽'], [0, 'spell', 'Ember Spell', '余烬法术']] });
  const combat = aggregateMobStats({ baseStats: [{ order: 300, school: 'universal', stat: 'resist', value: 10, unit: 'percent', label: '通用抗性' }, { order: 800, school: 'fire', stat: 'block', value: 100, unit: 'rating', label: '火焰格挡' }], equippedItems: [[{ order: 310, school: 'fire', stat: 'resist', value: 20, unit: 'percent', label: '火焰抗性' }]] });
  const entries = [
    { type: 'item', id: BIG, name: 'Ember Hat', object_name: 'Hat_Ember', kind: 'hat', school: 'fire', level: 170 },
    { type: 'item', id: '2', name: 'Ember Hat', object_name: 'Hat_Ember_Alt', kind: 'hat', school: 'fire', level: 160 },
    { type: 'item', id: '3', name: 'Frost Boots', object_name: 'Boots_Frost', kind: 'shoes', school: 'ice', level: 170 },
    { type: 'spell', id: '4', name: 'Ember Spell', object_name: 'Spell_Ember', school: 'fire', kind: 'damage', rank: 4, description_zh: '原描述中文版', effect_variants: [{ num_targets: 0, text: '通用目标效果', effect_count: 1 }, { num_targets: 7, text: '七目标专属效果', effect_count: 2 }], spell_effects_available: true },
    { type: 'pet', id: '5', name: 'Ember Pet', school: 'fire', wow_factor: 0, exclusive: false, talents: [{ name: 'Normal Talent', priority: 1 }], derby_talents: [{ name: 'Derby Talent', priority: 2 }] },
    { type: 'pet', id: '6', name: 'Unknown Pet', school: 'fire' },
    { type: 'fish', id: '7', name: 'Ember Fish', object_name: 'Fish_Ember', school: 'fire', rank: 1, is_sentinel: true, min_length: 3.5, max_length: 10.25 },
    { type: 'fish', id: '8', name: 'Frost Fish', object_name: 'Fish_Frost', school: 'ice', rank: 2, is_sentinel: false },
    { type: 'mob', id: '9', name: 'Ember Boss', object_name: 'Mob_Ember', kind: 'boss', school: 'fire', rank: 20, stats: { universal: { resist_percent: 10 } }, stats_scope: 'base_only', combat, deck: [{ name: 'Ember Spell', object_name: 'Spell_Ember', id: '4', count: 2 }] },
    ...[170, 190].map(level => ({ type: 'statcaps', id: String(9000 + level), name: `Fire Caps ${level}`, level, school: 'fire', damage_percent: 240 })),
    ...extra,
  ];
  const catalog = new LocalCatalog({ kind: 'wizard101.catalog', schemaVersion: 1, source: { name: 'Synthetic integration fixture', version: 'test', synthetic: true }, entries });
  const api = { dispose() {}, stats: () => ({}) };
  const controller = new KimerithController({ command: 'wiz', dataSource: 'local', cooldownMs: 0, pageSize: 8 }, dict, api, catalog);
  return { dict, catalog, controller, search: new KimerithSearch(catalog, dict), combat };
}

async function allText(output) {
  if (typeof output === 'string') return output;
  const pages = output.pages || await Promise.all(Array.from({ length: output.pageCount }, (_, i) => output.getPage(i)));
  return pages.map(page => page.text).join('\n');
}

test('canonical route inventory matches the fixed upstream public command contract', () => {
  const contract = require('../docs/upstream-command-contract.json');
  assert.equal(contract.revision, REVISION);
  assert.deepEqual([...ROUTES].sort(), contract.commands.map(c => c.route).filter(route => route !== 'sync').sort());
});

test('Chinese and traditional names, exact ID/Object, filters and explicit fuzzy names remain usable', () => {
  const { search, controller } = setup();
  try {
    assert.deepEqual(search.find('item', { name: '餘燼帽' }).items.map(e => e.id), [BIG, '2']);
    assert.deepEqual(search.find('item', { name: '余烬帽', school: '火焰', kind: '帽子', level: 170 }).items.map(e => e.id), [BIG]);
    assert.equal(search.find('item', { name: BIG, search_by: 'ID' }).items[0].id, BIG);
    assert.equal(search.find('item', { name: 'hAt_EmBeR', search_by: 'Object' }).items[0].id, BIG);
    assert.equal(search.find('item', { name: '1', search_by: 'ID' }).items.length, 0);
    const fuzzy = search.find('item', { name: 'Embr Hat' });
    assert.equal(fuzzy.exact, false);
    assert.equal(fuzzy.matched, 'Ember Hat');
    assert.equal(fuzzy.items.length, 2);
    assert.equal(search.list('item', { name: '*' }).total, 2, 'same display name is listed once');
    assert.equal(search.list('pet', { name: '*', wow: 0, exclusive: false }).total, 1, 'absent zero/false fields are not invented');
    assert.equal(search.list('fish', { name: 'fish_ember', use_object_name: true, is_sentinel: true }).items[0].id, '7');
    assert.equal(search.list('fish', { name: '*', rank: 2, school: '寒冰', is_sentinel: false }).items[0].id, '8');
  } finally { controller.dispose(); }
});

test('fuzzy character score agrees with upstream difflib behavior, including long repeated strings', () => {
  const cases = [['Embr Hat', 'Ember Hat'], ['Storm Lord', 'Lord of Storm'], ['tide', 'diet'], ['餘燼😀', '余烬😀'], ['a'.repeat(240) + 'b', 'a'.repeat(240) + 'c'], ['', ''], ['x', '']];
  const result = spawnSync(process.env.WIZARD101_TEST_PYTHON || process.env.PYTHON || 'python3', ['-c', 'import sys,json,difflib\nprint(json.dumps([round(difflib.SequenceMatcher(None,a,b).ratio()*100) for a,b in json.load(sys.stdin)]))'], { input: JSON.stringify(cases), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(cases.map(([a, b]) => ratio(a, b)), JSON.parse(result.stdout));
});

test('all canonical controller routes return Chinese result models and preserve parameter effects', async () => {
  const { controller, combat } = setup();
  try {
    const parameters = { base: 1000, damage: 100, pierce: 10, critical: 500, resist: 30, block: 100, buffs: '35 -50', pvp: false };
    for (const type of ['item', 'spell', 'mob', 'pet', 'fish']) {
      assert.match(await allText(await controller.execute(session, `${type}.list`, { name: '*' })), /列表/);
      const id = { item: BIG, spell: '4', mob: '9', pet: '5', fish: '7' }[type];
      const text = await allText(await controller.execute(session, `${type}.find`, { name: id, search_by: 'ID' }));
      assert.ok(text.includes(id));
      assert.match(text, /合成示例/);
    }
    assert.match(await allText(await controller.execute(session, 'spell.find', { name: '余烬法术' })), /原描述中文版/);
    const effects = await allText(await controller.execute(session, 'spell.find', { name: '4', search_by: 'ID', show_spell_effects: true, num_targets: 7 }));
    assert.match(effects, /七目标专属效果/);
    assert.doesNotMatch(effects, /原描述中文版/);
    assert.match(await allText(await controller.execute(session, 'spell.find', { name: '4', search_by: 'ID', show_spell_effects: true, num_targets: 8 })), /通用目标效果/);
    assert.match(await allText(await controller.execute(session, 'mob.deck', { name: '9', search_by: 'ID' })), /×2/);
    const input = { name: '9', search_by: 'ID', school: 'fire', ...parameters };
    const damage = calculateKimerithMobDamage({ base: parameters.base, damage: parameters.damage, pierce: parameters.pierce, critical: parameters.critical, buffs: parameters.buffs, pvp: false, school: 'fire', mobCombat: combat });
    const output = await allText(await controller.execute(session, 'mob.calc', input));
    assert.match(output, new RegExp(`未暴击伤害：${new Intl.NumberFormat('zh-CN').format(damage.normal)}`));
    assert.match(output, /抗性：30/);
    assert.match(output, /格挡评级：100/);
    assert.match(await allText(await controller.execute(session, 'calc', parameters)), /Kimerith 伤害计算/);
    assert.match(await allText(await controller.execute(session, 'help')), /wiz\.mob\.calc/);
    assert.match(await allText(await controller.execute(session, 'statcaps.find', { level: 179, school: '火焰' })), /查询 170 级档位/);
    assert.match(await allText(await controller.execute(session, 'statcaps.find', { level: 199, school: 'fire' })), /查询 190 级档位/);
    assert.match(await allText(await controller.execute(session, 'statcaps.find', { level: 200, school: 'fire' })), /等级超出范围/);
    assert.match(await controller.mobCalculate('9', 1000, { school: 'fire' }), /wiz\.mob\.calc/, 'legacy calculator must not reinterpret native ratings as percentages');
  } finally { controller.dispose(); }
});

test('complete name lists remain reachable after 60 pages and preserve user/channel isolation', async () => {
  const tail = 'Last_unique_marker';
  const entries = Array.from({ length: 1100 }, (_, i) => ({ type: 'item', id: String(20000 + i), name: `${i === 1099 ? 'Zzz' + tail : 'List'} ${String(i).padStart(5, '0')}`, school: 'fire' }));
  const { controller } = setup(entries);
  try {
    const reply = await controller.execute(session, 'item.list', { name: '*' });
    assert.ok(reply.pageCount > 60);
    controller.prepareReply(session, reply);
    assert.match(controller.responseNavigate(session, 'last').text, new RegExp(tail));
    assert.match(controller.responseNavigate({ ...session, userId: 'stranger' }, 'last').text, /没有当前详情/);
    assert.match(controller.responseNavigate({ ...session, channelId: 'elsewhere' }, 'last').text, /没有当前详情/);
    assert.match(controller.responseNavigate(session, 'first').text, /第 1\//);
  } finally { controller.dispose(); }
});

test('lazy reply expansion retains encoding-heavy tails instead of silently shortening messages', () => {
  const { controller } = setup();
  try {
    const text = '*_😀'.repeat(800) + 'ENCODING_TAIL';
    const output = { kind: 'wizard101.reply', pageCount: 1, getPage() { return { text, summary: 'Synthetic' }; } };
    const pieces = [controller.prepareReply(session, output).text];
    let state = [...controller.responses.values()][0];
    for (let page = 2; page <= state.provider.pageCount; page++) pieces.push(controller.responsePage(session, page).text);
    assert.ok(pieces.join('\n').includes('ENCODING_TAIL'));
    assert.ok(pieces.every(value => textCost(neutralizeMentions(value, 'discord'), 'discord') <= 1800));
  } finally { controller.dispose(); }
});

test('complex imported effects and more than 120 fields retain all text through canonical views', async () => {
  const description = '连续法术效果。'.repeat(4000) + 'LONG_EFFECT_TAIL';
  const extra = { type: 'spell', id: '99', name: 'Complex Spell', description_zh: description, effect_variants: [{ num_targets: 0, text: description, effect_count: 1 }], effect_unparsed: Array.from({ length: 600 }, (_, i) => ({ id: String(i), type_name: '未解释效果', reason: `原始记录-${i}`, raw: [1, 2, 3] })) };
  const { controller, catalog, dict } = setup([extra]);
  try {
    const plain = views.details(catalog.get('spell', '99'), dict, catalog);
    const text = await allText(plain);
    assert.match(text, /原始记录-599/);
    assert.match(text, /LONG_EFFECT_TAIL/);
    assert.doesNotMatch(text, /另有.*超出展示上限|后续请查看资料源/);
    const effect = await controller.execute(session, 'spell.find', { name: '99', search_by: 'ID', show_spell_effects: true });
    assert.match(await allText(effect), /LONG_EFFECT_TAIL/);
  } finally { controller.dispose(); }
});

test('local portraits accept bounded PNGs, refuse path escapes, and occupy a real image band', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wiz-portraits-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const dir = path.join(root, 'portraits');
  await fs.mkdir(dir);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');
  await fs.writeFile(path.join(dir, 'Pet.png'), png);
  await fs.writeFile(path.join(root, 'outside.png'), png);
  await fs.symlink(path.join(root, 'outside.png'), path.join(dir, 'Escape.png'));
  await fs.writeFile(path.join(dir, 'Bad.png'), 'not a PNG');
  const store = new PortraitStore(dir);
  const uri = await store.get('Pet.png');
  assert.match(uri, /^data:image\/png;base64,/);
  for (const name of ['../outside.png', 'Escape.png', 'https://example.invalid/p.png', 'Bad.png']) assert.equal(await store.get(name), '');
  const model = { kind: 'pet', title: '合成宠物', portrait: 'Pet.png', sections: [{ title: '属性', rows: [{ label: '力量', value: '250' }] }] };
  const svg = createCardSvg(model, new Map(), 'Sans', uri);
  assert.ok(svg.includes(uri));
  const renderer = new CardRenderer({ portraitPath: dir, fontPath: process.env.WIZ_TEST_CJK_FONT });
  await renderer.initialize();
  if (renderer.status().fontAvailable && renderer.status().rendererAvailable) {
    const rendered = await renderer.render(model);
    assert.ok(rendered?.length > 1000);
    assert.ok(rendered.readUInt32BE(20) > 350);
  }
  renderer.dispose();
  store.dispose();
  assert.equal(await store.get('Pet.png'), '');
});
