'use strict';

// Full command registration, parsing, dispatch, and pagination through real
// Koishi + its official mock adapter. Records and identities are synthetic.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { Context } = require('koishi');
const mock = require('@koishijs/plugin-mock').default;
const { Discord } = require('@satorijs/adapter-discord');
const plugin = require('../lib/index.cjs');

const BIG_ID = '4611686020152371460';
const REVISION = '3c24847d111387fc0b34772b548f74e80089599f';
const DESCRIPTION_END = '说明完整结尾_RUNTIME_COMPLETE';
const TRANSLATIONS = [
  ['Runtime Arcane Hat', '合成奥术帽'], ['Runtime Solar Burst', '合成太阳爆发'],
  ['Runtime Test Sentinel', '合成试验守卫'], ['Runtime Ember Companion', '合成余烬伙伴'],
  ['Runtime Exclusive Companion', '合成专属伙伴'], ['Runtime Crystal Fish', '合成水晶鱼'],
  ['Runtime Sentinel Fish', '合成哨兵鱼'],
];

function fixtures() {
  return {
    dictionary: { schemaVersion: 1, source: { filename: 'synthetic-kimerith.lang' }, stats: {}, files: [{ path: 'Runtime.lang', table: 'Runtime', records: TRANSLATIONS.length }], entries: TRANSLATIONS.map(([en, zh], index) => [0, `entry-${index}`, en, zh]) },
    catalog: {
      kind: 'wizard101.catalog', schemaVersion: 1, source: { name: 'Synthetic Kimerith runtime catalog', version: 'test-only', synthetic: true },
      entries: [
        { type: 'item', id: BIG_ID, name: 'Runtime Arcane Hat', object_name: 'Gear_Runtime_Arcane_A', school: 'fire', kind: 'hat', level: 170, native_stats: [{ label: '合成火焰伤害', value: 20, unit: 'percent' }], description: ('说明开始\n' + '完整分页合成段落。'.repeat(210)).padEnd(2000, '文') + DESCRIPTION_END },
        { type: 'item', id: '1102', name: 'Runtime Arcane Hat', object_name: 'Gear_Runtime_Arcane_B', school: 'ice', kind: 'hat', level: 90 },
        ...Array.from({ length: 36 }, (_, i) => ({ type: 'item', id: String(1200 + i), name: `Runtime Listing Hat ${String(i).padStart(2, '0')}`, object_name: `Gear_Runtime_List_${i}`, school: 'fire', kind: 'hat', level: 170 })),
        { type: 'item', id: '1300', name: 'Runtime Storm Boots', school: 'storm', kind: 'shoes', level: 80 },
        { type: 'spell', id: '2101', name: 'Runtime Solar Burst', object_name: 'Spell_Runtime_Solar', school: 'fire', kind: 'damage', rank: 4, rank_label: '4', description_zh: '普通说明标记：造成合成火焰伤害。', effect_variants: [{ num_targets: 0, text: '通用效果回退标记' }, { num_targets: 1, text: '单目标效果标记：150 点火焰伤害。' }, { num_targets: 2, text: '双目标效果标记：每个目标 150 点火焰伤害。' }], effect_warnings: [] },
        { type: 'spell', id: '2102', name: 'Runtime Frost Heal', object_name: 'Spell_Runtime_Frost', school: 'ice', kind: 'healing', rank: 2, description_zh: '合成治疗法术。' },
        { type: 'mob', id: '3101', name: 'Runtime Test Sentinel', object_name: 'Mob_Runtime_Sentinel', school: 'fire', kind: 'boss', rank: 18, health: 10000, combat: { revision: REVISION, stats_scope: 'base_and_equipment', complete: true, duplicate_mode: 'upstream', raw_stats: [{ order: 45, label: '火焰抗性', school: 'fire', stat: 'resist', value: 30, unit: 'percent' }, { order: 10, label: '格挡评级', school: 'universal', stat: 'block', value: 100, unit: 'rating' }], display_stats: [{ label: '火焰抗性', value: 30, unit: 'percent' }, { label: '格挡评级', value: 100, unit: 'rating' }], target_by_school: { fire: { resist: 30, block: 100 } }, warnings: [] }, deck: [{ id: '2101', name: 'Runtime Solar Burst', object_name: 'Spell_Runtime_Solar', count: 3 }, { id: '2102', name: 'Runtime Frost Heal', count: 2 }] },
        { type: 'mob', id: '3102', name: 'Runtime Frost Guard', object_name: 'Mob_Runtime_Frost', school: 'ice', kind: 'elite', rank: 8 },
        { type: 'pet', id: '4101', name: 'Runtime Ember Companion', object_name: 'Pet_Runtime_Ember', school: 'fire', wow_factor: 67, exclusive: false, strength: 250, intellect: 240, agility: 230, will: 220, power: 210, talents: [{ name: 'Synthetic Ordinary Talent' }], derby_talents: [{ name: 'Synthetic Derby Talent' }] },
        { type: 'pet', id: '4102', name: 'Runtime Exclusive Companion', object_name: 'Pet_Runtime_Exclusive', school: 'fire', wow_factor: 67, exclusive: true },
        { type: 'fish', id: '5101', name: 'Runtime Crystal Fish', object_name: 'Fish_Runtime_Crystal_A', school: 'ice', rank: 2, is_sentinel: false, base_length: 12.5, min_size: 0.8, max_size: 1.2 },
        { type: 'fish', id: '5102', name: 'Runtime Sentinel Fish', object_name: 'Fish_Runtime_Sentinel_B', school: 'ice', rank: 2, is_sentinel: true },
        { type: 'statcaps', id: '6101', name: 'Runtime Fire Caps 170', school: 'fire', level: 170, damage_percent: 240, resist_percent: 80, critical_rating: 1000 },
      ],
    },
  };
}

async function setup(t, config = {}, { discord = false } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wizard101-kimerith-runtime-'));
  const { dictionary, catalog } = fixtures();
  const localePath = path.join(directory, 'locale.json'), catalogPath = path.join(directory, 'catalog.json');
  await fs.writeFile(localePath, JSON.stringify(dictionary));
  await fs.writeFile(catalogPath, JSON.stringify(catalog).replace(`"${BIG_ID}"`, BIG_ID));
  const apiRequests = [];
  const server = http.createServer((request, response) => { apiRequests.push(request.url); response.writeHead(503, { 'Content-Type': 'application/json' }); response.end('{"error":"unexpected API request in local runtime test"}'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const app = new Context({ prefix: '', autoAuthorize: 1, delay: { character: 0, message: 0 }, locale: 'zh-CN' });
  app.baseDir = directory;
  app.plugin(mock);
  const authorities = new Map([['ordinary', 1], ['admin', 4]]);
  app.on('attach', session => {
    if (authorities.has(session.userId)) session.user = { authority: authorities.get(session.userId), permissions: [], locales: ['zh-CN'], async $update() {} };
  });
  const discordCalls = [], commands = [];
  if (discord) {
    // Retain the real mock transport while presenting its bot identity to the
    // administrator selection code as Discord. All Internal HTTP calls are stubs.
    const bot = app.bots[0];
    bot.platform = 'discord'; bot.config.slash = false;
    bot.logger = app.logger('synthetic-discord');
    bot.http = async (method, url, { data } = {}) => {
      discordCalls.push({ method, url, data });
      if (method === 'GET' && url.endsWith('/commands')) return { data: structuredClone(commands) };
      if (method === 'POST' && url.endsWith('/commands')) { const command = { ...data, id: String(700000000000000000n + BigInt(commands.length)) }; commands.push(command); return { data: command }; }
      if (method === 'PATCH' && /\/commands\/\d+$/.test(url)) return { data: { ...data, id: url.split('/').at(-1) } };
      assert.fail(`Unstubbed Discord operation ${method} ${url}`);
    };
    bot.http.isError = () => false;
    bot.internal = new Discord.Internal(bot);
  }
  app.plugin(plugin, { localePath, catalogPath, dataSource: 'local', replyMode: 'text', apiKey: '', userAgent: 'wizard101-kimerith-runtime/0.3.0 (test@example.invalid)', baseUrl: `http://127.0.0.1:${server.address().port}/api/v1`, pageSize: 2, cooldownMs: 0, minIntervalMs: 0, onlineSearchEnabled: false, enableChineseAliases: true, ...config });
  t.after(async () => { await app.stop(); await new Promise(resolve => server.close(resolve)); await fs.rm(directory, { recursive: true, force: true }); });
  await app.start();
  const client = app.mock.client('runtime-user');
  const ask = async (command, target = client) => (await target.receive(command)).join('\n');
  async function all(command, target = client) {
    const first = await ask(command, target), pages = [first];
    let total = Number(first.match(/第 1\/(\d+) 页/)?.[1] || 1);
    assert.ok(total < 400, 'synthetic fixture unexpectedly produced hundreds of pages');
    for (let page = 2; page <= total; page++) {
      const result = await ask(`wiz.page ${page}`, target);
      assert.doesNotMatch(result, /没有当前详情|只有 \d+ 页/);
      pages.push(result);
      const updated = result.match(/第 \d+\/(\d+) 页/);
      if (updated) total = Number(updated[1]);
    }
    return pages.join('\n');
  }
  return { app, directory, ask, all, client, apiRequests, discordCalls, commands };
}

test('all 15 canonical commands run through real Koishi and read the complete localized response', async t => {
  const f = await setup(t);
  const cases = [
    ['wiz.item.find -s fire -l 170 -k Hat 合成奥术帽', [/合成奥术帽/, /20%/, new RegExp(BIG_ID), new RegExp(DESCRIPTION_END)]],
    ['wiz.item.list -s fire -l 170 -k Hat Runtime', [/装备列表/, /共 37 个不同名称/, /Runtime Listing Hat 35/]],
    ['wiz.spell.find --effects true --targets 2 -s fire -k Damage -r 4 合成太阳爆发', [/法术效果 · 2 个目标/, /双目标效果标记/]],
    ['wiz.spell.list -s fire -r 4 Runtime', [/合成太阳爆发/, /共 1 个不同名称/]],
    ['wiz.mob.find -s fire -k Boss -r 18 合成试验守卫', [/怪物本体与装备属性/, /火焰抗性：30%/, /格挡评级：100/]],
    ['wiz.mob.list -s fire -k Boss -r 18 Runtime', [/合成试验守卫/, /共 1 个不同名称/]],
    ['wiz.mob.deck --search-by Object Mob_Runtime_Sentinel', [/怪物与装备牌组/, /合成太阳爆发.*×3/, /Runtime Frost Heal.*×2/]],
    ['wiz.mob.calc -s fire --base 1000 -d 100 -p 0 -c 0 --pvp false 合成试验守卫', [/伤害计算/, /未暴击伤害：1,400/, /暴击伤害：1,400/, /PvE/]],
    ['wiz.pet.find --exclusive false --wow 67 -s fire 合成余烬伙伴', [/合成余烬伙伴/, /250/, /Synthetic Ordinary Talent/, /Synthetic Derby Talent/]],
    ['wiz.pet.list --exclusive false --wow 67 -s fire Runtime', [/共 1 个不同名称/, /合成余烬伙伴/]],
    ['wiz.fish.find --sentinel false -s ice -r 2 合成水晶鱼', [/合成水晶鱼/, /哨兵鱼：否/, /12.5/]],
    ['wiz.fish.list --sentinel true -s ice -r 2 Runtime', [/共 1 个不同名称/, /合成哨兵鱼/]],
    ['wiz.statcaps.find 179 fire', [/输入 179 级，查询 170 级档位/, /240%/]],
    ['wiz.calc 1000 -d 100 -p 0 -c 0 -r 25 --block 100', [/未暴击伤害：1,500/, /暴击伤害：1,500/]],
    ['wiz.help', [/Kimerith 中文版/, /wiz\.item\.find/, /wiz\.mob\.calc/, /wiz\.fish\.list/]],
  ];
  for (const [command, patterns] of cases) {
    const response = await f.all(command);
    assert.ok(response, command);
    for (const pattern of patterns) assert.match(response, pattern, command);
    assert.doesNotMatch(response, /查询暂时失败|未配置.*API Key/, command);
  }
  assert.equal(f.apiRequests.length, 0);
});

test('exact Name/Object/64-bit ID modes, false flags, and integer-first calc options preserve their meaning', async t => {
  const f = await setup(t);
  assert.match(await f.all(`wiz.item.find --search-by ID ${BIG_ID}`), new RegExp(BIG_ID));
  const object = await f.all('wiz.item.find --search-by Object Gear_Runtime_Arcane_B');
  assert.match(object, /条目 ID：1102/);
  assert.doesNotMatch(object, new RegExp(BIG_ID));
  assert.match(await f.all('wiz.item.find --search-by Name -s fire 合成奧術帽'), /合成奥术帽/);
  const noEffects = await f.all('wiz.spell.find --effects false --targets 2 合成太阳爆发');
  assert.match(noEffects, /普通说明标记/);
  assert.doesNotMatch(noEffects, /双目标效果标记/);
  const normalFish = await f.all('wiz.fish.list --sentinel false --object-names true Fish_Runtime');
  assert.match(normalFish, /Fish_Runtime_Crystal_A/);
  assert.doesNotMatch(normalFish, /Fish_Runtime_Sentinel_B/);
  assert.match(await f.all('wiz.pet.list --exclusive perhaps *'), /布尔参数必须是 true 或 false/);
  const pve = await f.all('wiz.calc 100 -d 0 -p 50 -c 300 -r 0 --block 100 --buffs "20P -50P 25" --pvp false');
  assert.match(pve, /未暴击伤害：125/);
  assert.match(pve, /暴击伤害：187/);
  assert.match(pve, /没有自动调用 pve_damage_curve/);
  const pvp = await f.all('wiz.calc 100 -d 0 -p 50 -c 300 -r 0 --block 100 --buffs "20P -50P 25" --pvp true');
  assert.match(pvp, /暴击伤害：171/);
  assert.equal(f.apiRequests.length, 0);
});

test('Chinese aliases resolve through every level of the real Koishi command hierarchy', async t => {
  const f = await setup(t);
  assert.match(await f.all(`巫师.装备.查询 --search-by ID ${BIG_ID}`), new RegExp(BIG_ID));
  for (const [noun, name] of [['法术', '合成太阳爆发'], ['怪物', '合成试验守卫'], ['宠物', '合成余烬伙伴'], ['鱼类', '合成水晶鱼']]) {
    assert.match(await f.all(`巫师.${noun}.查询 ${name}`), new RegExp(name));
    assert.match(await f.all(`巫师.${noun}.列表 ${name}`), /共 1 个不同名称/);
  }
  assert.match(await f.all('巫师.装备.列表 -s fire Runtime Arcane'), /共 1 个不同名称/);
  assert.match(await f.all('巫师.怪物.牌组 合成试验守卫'), /合成太阳爆发.*×3/);
  assert.match(await f.all('巫师.怪物.计算 -s 火焰 --base 1000 -d 100 -p 0 -c 0 合成试验守卫'), /未暴击伤害：1,400/);
  assert.match(await f.all('巫师.属性上限.查询 179 火焰'), /输入 179 级，查询 170 级档位/);
  assert.match(await f.all('巫师.计算 1000 -d 100 -p 0 -c 0 -r 25 --block 100'), /未暴击伤害：1,500/);
  assert.match(await f.all('巫师.帮助'), /Kimerith 中文版/);
  assert.equal(f.apiRequests.length, 0);
});

test('canonical lazy lists and details remain complete, navigable, and isolated by user/channel', async t => {
  const f = await setup(t);
  const first = await f.ask('wiz.item.list -s fire -l 170 Runtime Listing');
  assert.match(first, /第 1\/(\d+) 页/);
  const last = await f.ask('wiz.page.last');
  assert.match(last, /Runtime Listing Hat 35/);
  const lastIndex = Number(last.match(/第 (\d+)\/\d+ 页/)[1]);
  assert.ok(lastIndex > 1);
  assert.match(await f.ask('wiz.page.prev'), new RegExp(`第 ${lastIndex - 1}/${lastIndex} 页`));
  assert.match(await f.ask('wiz.page.first'), new RegExp(`第 1/${lastIndex} 页`));
  assert.match(await f.ask('wiz.page.next'), new RegExp(`第 2/${lastIndex} 页`));
  const other = f.app.mock.client('another-user');
  const anotherChannel = f.app.mock.client('runtime-user', 'another-channel');
  for (const target of [other, anotherChannel]) assert.match(await f.ask('wiz.page.last', target), /没有当前详情|已过期/);
  await f.ask('wiz.fish.list *', other);
  assert.match(await f.ask('wiz.page.last'), /Runtime Listing Hat 35/);
  const listing = await f.all('wiz.item.list -s fire -l 170 Runtime Listing');
  for (let i = 0; i < 36; i++) assert.match(listing, new RegExp(`Runtime Listing Hat ${String(i).padStart(2, '0')}`));
  const full = await f.all(`wiz.item.find --search-by ID ${BIG_ID}`);
  assert.match(full, new RegExp(DESCRIPTION_END));
  assert.doesNotMatch(full, /4611686020152371000/);
  assert.equal(f.apiRequests.length, 0);
});

test('Discord native registration is off by default and starting the plugin never writes commands', async t => {
  assert.equal(plugin.defaults.nativeDiscordEnabled, false);
  const f = await setup(t, {}, { discord: true });
  assert.equal(f.discordCalls.length, 0);
  const admin = f.app.mock.client('admin');
  assert.match(await f.ask('wiz.sync', admin), /nativeDiscordEnabled|启用/);
  assert.equal(f.discordCalls.length, 0);
  await f.ask('wiz.help');
  assert.equal(f.discordCalls.length, 0);
});

test('enabled registration still requires verified authority 4 and an explicit administrator sync', async t => {
  const f = await setup(t, { nativeDiscordEnabled: true }, { discord: true });
  assert.equal(f.discordCalls.length, 0);
  const unverified = await f.ask('wiz.sync');
  assert.match(unverified, /权限|管理员|身份/);
  assert.equal(f.discordCalls.length, 0, 'no database/user identity must fail closed');
  const ordinary = f.app.mock.client('ordinary');
  assert.match(await f.ask('wiz.sync', ordinary), /权限|管理员|权限不足/);
  assert.equal(f.discordCalls.length, 0);
  const admin = f.app.mock.client('admin');
  assert.match(await f.ask('wiz.sync --guild 201000000000000001', admin), /同步完成/);
  assert.equal(f.commands.length, 8);
  assert.equal(f.discordCalls.filter(call => call.method === 'POST').length, 8);
  assert.equal(f.discordCalls.some(call => ['PUT', 'DELETE'].includes(call.method)), false);
  const registry = JSON.parse(await fs.readFile(path.join(f.directory, 'data/wizard101/native-commands.json'), 'utf8'));
  assert.equal(registry.commands.length, 8);
  assert.equal(f.apiRequests.length, 0);
});
