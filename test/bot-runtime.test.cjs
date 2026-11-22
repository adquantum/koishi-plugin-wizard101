'use strict';

// Real Koishi commands + official mock chat adapter. All game records below
// are synthetic, and the loopback HTTP trap never supplies real API content.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { Context } = require('koishi');
const mock = require('@koishijs/plugin-mock').default;
const plugin = require('../lib/index.cjs');
const { CardRenderer, createCardSvg } = require('../lib/cards.cjs');

const BIG_ID = '4611686020152371460';
const PRIVATE_KEY = 'synthetic-server-key-do-not-echo';
const KEY_SHAPE = 'w404_dev_SYNTHETIC_ONLY';
const LONG_END = 'LONG_DESCRIPTION_END_结尾内容必须可翻页读取';

function dictionaryFixture() {
  return {
    schemaVersion: 1, source: { filename: 'synthetic.lang' }, stats: {},
    files: [{ path: 'Synthetic.lang', table: 'Synthetic', records: 3 }],
    entries: [
      [0, 'pet', 'Synthetic Ember Pet', '合成余烬幼宠'],
      [0, 'fish', 'Synthetic Crystal Fish', '合成水晶鱼'],
      [0, 'hat', 'Arcane Hat A', '合成奥术帽甲'],
    ],
  };
}

function catalogFixture() {
  return {
    kind: 'wizard101.catalog', schemaVersion: 1,
    source: { name: 'Synthetic runtime catalog', version: 'test-only', synthetic: true },
    entries: [
      ...['A', 'B', 'C', 'D', 'E'].map((letter, i) => ({ type: 'item', id: String(1001 + i), name: `Arcane Hat ${letter}`, school: 'fire', level: 170, kind: 'hat', stats: { health: 100 + i, damage_percent: 10 + i } })),
      { type: 'item', id: '1006', name: 'Frost Boot', school: 'ice', level: 90, kind: 'shoes' },
      { type: 'pet', id: BIG_ID, name: 'Synthetic Ember Pet', school: 'fire', wow_factor: 67, exclusive: true, strength: 250, intellect: 240, agility: 230, will: 220, power: 210 },
      { type: 'pet', id: '2102', name: 'Synthetic Frost Pet', school: 'ice', wow_factor: 42, exclusive: false },
      { type: 'fish', id: '2201', name: 'Synthetic Crystal Fish', school: 'ice', rank: 2, is_sentinel: true, base_length: 12.5 },
      { type: 'fish', id: '2202', name: 'Synthetic Ember Fish', school: 'fire', rank: 1, is_sentinel: false },
      { type: 'statcaps', id: '3001', name: 'Synthetic Fire Caps 170', school: 'fire', level: 170, damage_percent: 240, resist_percent: 80 },
      { type: 'mob', id: '4001', name: 'Exact Percent Mob', school: 'fire', stats: { resist_percent: { fire: 30 }, resist: 999 } },
      { type: 'mob', id: '4002', name: 'Ambiguous Resist Mob', school: 'ice', stats: { resist: 30 } },
      { type: 'item', id: '5001', name: 'Long Description Item', school: 'fire', description: 'START_OF_LONG_DESCRIPTION\n' + Array.from({ length: 36 }, (_, i) => `段落${String(i).padStart(2, '0')}：这是一段合成的图鉴说明，完整内容需要通过详情分页读取，不能只保留开头一百八十字。`).join('\n') + '\n' + LONG_END },
      { type: 'item', id: '6001', name: `<at type="all"/> ${PRIVATE_KEY} ${KEY_SHAPE}`, school: 'fire', description: '<img src="file:///private/fixture-only"/> & 测试图卡转义', api_key: 'hidden-field-should-not-render' },
    ],
  };
}

async function setup(t, config = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wizard101-bot-runtime-'));
  const localePath = path.join(directory, 'locale.json');
  const catalogPath = path.join(directory, 'catalog.json');
  const badFont = path.join(directory, 'bad-font.ttf');
  await fs.writeFile(localePath, JSON.stringify(dictionaryFixture()));
  // Test the importer boundary with an unquoted 64-bit ID on disk.
  await fs.writeFile(catalogPath, JSON.stringify(catalogFixture()).replace(`"${BIG_ID}"`, BIG_ID));
  await fs.writeFile(badFont, 'not-a-font');
  const requests = [];
  const server = http.createServer((request, response) => {
    requests.push(request.url);
    response.writeHead(503, { 'Content-Type': 'application/json' });
    response.end('{"error":"local-only test unexpectedly attempted the API"}');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const app = new Context({ prefix: '', autoAuthorize: 1, delay: { character: 0, message: 0 } });
  app.plugin(mock);
  const sent = [];
  app.before('send', session => { sent.push(session.elements); });
  const fork = app.plugin(plugin, {
    catalogPath, localePath, dataSource: 'local', replyMode: 'text',
    apiKey: '', userAgent: 'wizard101-runtime/0.2.0 (test@example.invalid)',
    baseUrl: `http://127.0.0.1:${server.address().port}/api/v1`,
    pageSize: 2, cooldownMs: 0, minIntervalMs: 0, timeoutMs: 100,
    onlineSearchEnabled: false,
    ...config,
    ...(config.fontPath === 'BAD_FONT_FIXTURE' ? { fontPath: badFont } : {}),
  });
  t.after(async () => {
    await app.stop();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await fs.rm(directory, { recursive: true, force: true });
  });
  await app.start();
  const client = app.mock.client('catalog-user');
  return { app, fork, client, sent, requests, directory, async ask(command, target = client) { return (await target.receive(command)).join('\n'); } };
}

test('real commands resolve local pets/fish/caps without a key and parse filters before text', async t => {
  const { ask, requests } = await setup(t);
  const pet = await ask('wiz.pet 合成余烬幼宠');
  assert.match(pet, /Synthetic Ember Pet|合成余烬幼宠/u);
  assert.ok(pet.includes(BIG_ID), '64-bit IDs must remain exact through disk loading and command rendering');
  assert.doesNotMatch(pet, /4611686020152371000/);
  assert.match(await ask('wiz.fish 合成水晶鱼'), /Synthetic Crystal Fish|合成水晶鱼/u);
  assert.match(await ask('wiz.statcaps fire 170'), /240/);
  assert.match(await ask('wiz.statcaps fire 169'), /没有.*169/u);

  const pets = await ask('wiz.list -t pet -s fire --wow 67 --exclusive true Synthetic');
  assert.match(pets, /共 1 项/u);
  assert.match(pets, /Synthetic Ember Pet|合成余烬幼宠/u);
  assert.doesNotMatch(pets, /Synthetic Frost Pet/);
  const fish = await ask('wiz.list -t fish -s ice -r 2 --sentinel true Synthetic');
  assert.match(fish, /共 1 项/u);
  assert.match(fish, /Synthetic Crystal Fish|合成水晶鱼/u);
  assert.doesNotMatch(fish, /Synthetic Ember Fish/);
  const items = await ask('wiz.list -t item -s fire -l 170 -k hat Arcane');
  assert.match(items, /共 5 项/u);
  assert.doesNotMatch(items, /Frost Boot/);
  assert.equal(requests.length, 0);
});

test('local-only entity types remain searchable by name when API is the preferred source', async t => {
  const { ask, requests } = await setup(t, { dataSource: 'api' });
  assert.match(await ask('wiz.pet 合成余烬幼宠'), /Synthetic Ember Pet|合成余烬幼宠/u);
  assert.match(await ask('wiz.fish Synthetic Crystal Fish'), /Synthetic Crystal Fish|合成水晶鱼/u);
  assert.equal(requests.length, 0, 'pet/fish must not fall through to unsupported remote routes');
});

test('pick and first/previous/next/last navigation retain independent users and channels', async t => {
  const { ask, app, client, requests } = await setup(t);
  const first = await ask('wiz.list -t item Arcane');
  assert.match(first, /第 1\/3 页/u);
  assert.match(first, /Arcane Hat A/);
  const otherUser = app.mock.client('another-catalog-user');
  const otherChannel = app.mock.client('catalog-user', 'another-channel');
  for (const target of [otherUser, otherChannel]) {
    assert.match(await ask('wiz.pick 1', target), /没有|先/u);
    assert.match(await ask('wiz.next', target), /没有|先/u);
  }
  await ask('wiz.list -t fish', otherUser);
  const second = await ask('wiz.next', client);
  assert.match(second, /第 2\/3 页/u);
  assert.match(second, /Arcane Hat C/);
  const last = await ask('wiz.last');
  assert.match(last, /第 3\/3 页/u);
  assert.match(last, /Arcane Hat E/);
  assert.match(await ask('wiz.pick 1'), /1005/);
  assert.match(await ask('wiz.prev'), /第 2\/3 页/u);
  assert.match(await ask('wiz.first'), /第 1\/3 页/u);
  const otherPick = await ask('wiz.pick 1', otherUser);
  assert.match(otherPick, /Synthetic Crystal Fish|合成水晶鱼/u);
  assert.doesNotMatch(otherPick, /Arcane Hat/);
  assert.equal(requests.length, 0);
});

test('long description continuation is accessible and isolated from other users', async t => {
  const { ask, app } = await setup(t);
  const first = await ask('wiz.item 5001');
  const count = /第 1\/(\d+) 页/u.exec(first);
  assert.ok(count && Number(count[1]) > 1, 'long descriptions need actual stored response pages');
  const strangers = await ask('wiz.page 2', app.mock.client('page-stranger'));
  assert.match(strangers, /没有当前详情/u);
  const pages = [first];
  for (let page = 2; page <= Number(count[1]); page++) pages.push(await ask(`wiz.page ${page}`));
  assert.ok(pages.join('\n').includes('结尾内容必须可翻页读取'), 'the original description tail must survive translation and pagination');
  assert.match(await ask(`wiz.page ${Number(count[1]) + 1}`), /只有/u);
});

test('calc parses options after numbers and mobcalc accepts only explicit percentage resistance', async t => {
  const { ask, requests } = await setup(t);
  const exact = await ask('wiz.calc 1000 --shields 30,30');
  assert.match(exact, /普通伤害估算：490/u);
  assert.doesNotMatch(exact, /普通伤害估算：489/u);
  const amplified = await ask('wiz.calc 1000 -d 100 -b 40 -r 20 -p 10');
  assert.match(amplified, /普通伤害估算：2520/u);
  const mob = await ask('wiz.mobcalc 4001 1000 -s fire -d 100 -b 40 -p 10');
  assert.match(mob, /普通伤害估算：2240/u);
  assert.match(mob, /抗性 30%/u);
  assert.match(await ask('wiz.mobcalc 4002 1000 -s ice'), /没有明确标注单位.*resist_percent/u);
  assert.match(await ask('wiz.calc 1000 --shields 101'), /输入错误/u);
  assert.match(await ask('wiz.calc 1000 -b 0.0000001'), /最多支持 6 位小数/u);
  assert.equal(requests.length, 0);
});

test('a configured invalid font falls back to readable text without leaking paths', async t => {
  const { ask, sent, directory } = await setup(t, { replyMode: 'image', fontPath: 'BAD_FONT_FIXTURE' });
  const result = await ask('wiz.item 1001');
  assert.match(result, /Arcane Hat A|合成奥术帽甲/u);
  assert.doesNotMatch(result, /bad-font\.ttf/);
  assert.ok(!result.includes(directory));
  assert.ok(sent.length > 0);
  assert.ok(sent.flat().every(element => element.type === 'text'));
});

test('forced image reaches the real PNG renderer with redacted and escaped content', async t => {
  const probe = new CardRenderer({ fontPath: process.env.WIZ_TEST_CJK_FONT });
  await probe.initialize();
  const available = probe.status().fontAvailable && probe.status().rendererAvailable;
  const fontPath = probe.font?.path;
  probe.dispose();
  if (!available) return t.skip('Install a CJK font and @resvg/resvg-js for the real PNG bot integration test.');

  const models = [];
  const original = CardRenderer.prototype.render;
  CardRenderer.prototype.render = async function (model) {
    models.push(structuredClone(model));
    return original.call(this, model);
  };
  t.after(() => { CardRenderer.prototype.render = original; });
  const { ask, sent, requests } = await setup(t, { replyMode: 'image', fontPath, apiKey: PRIVATE_KEY });
  await ask('wiz.item 6001');
  const image = sent.flat().find(element => element.type === 'img');
  assert.ok(image, 'force-image replies must include the actual raster image');
  assert.equal(sent.length, 1, 'the official mock adapter has no message IDs but must not trigger a duplicate fallback');
  assert.match(image.attrs.src.slice(0, 32), /^data:image\/png;base64,/);
  const png = Buffer.from(image.attrs.src.split(',')[1], 'base64');
  assert.deepEqual(png.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  assert.equal(png.readUInt32BE(16), 900);
  assert.ok(png.readUInt32BE(20) > 200 && png.length > 1000);
  const modelText = JSON.stringify(models);
  const caption = sent.flat().filter(element => element.type === 'text').map(element => element.attrs.content).join('\n');
  for (const value of [PRIVATE_KEY, KEY_SHAPE, 'hidden-field-should-not-render']) {
    assert.ok(!modelText.includes(value), 'sensitive values must be removed before rasterization');
    assert.ok(!caption.includes(value), 'captions must use the same redaction');
  }
  assert.match(modelText, /已隐藏密钥/u);
  assert.ok(sent.flat().every(element => element.type === 'text' || element.type === 'img'));
  const svg = createCardSvg(models[0], new Map(), 'Synthetic CJK font');
  assert.doesNotMatch(svg, /<at\b|<img\b/);
  assert.match(svg, /&lt;at/);
  assert.equal(requests.length, 0);
});
