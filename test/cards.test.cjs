'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { CardRenderer, normalizeModel, createCardSvg, wrapText, inspectFont, pngDimensions, toCardModel } = require('../lib/cards.cjs');

function png() {
  function chunk(type, data) {
    const body = Buffer.concat([Buffer.from(type), data]);
    let crc = 0xffffffff;
    for (const byte of body) {
      crc ^= byte;
      for (let i = 0; i < 8; i++) crc = crc >>> 1 ^ (crc & 1 ? 0xedb88320 : 0);
    }
    const header = Buffer.alloc(4), tail = Buffer.alloc(4);
    header.writeUInt32BE(data.length); tail.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([header, body, tail]);
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(4); ihdr.writeUInt32BE(4, 4); ihdr[8] = 8; ihdr[9] = 6;
  const pixels = Buffer.alloc(4 * 17, 255);
  for (let y = 0; y < 4; y++) { pixels[y * 17] = 0; for (let x = 0; x < 4; x++) pixels[y * 17 + x * 4 + 2] = 70; }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}

async function temporary(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wiz-card-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

async function catalog(directory, entry = { file: 'icon.png' }) {
  await fs.writeFile(path.join(directory, 'icon.png'), png());
  const manifest = path.join(directory, 'manifest.json');
  await fs.writeFile(manifest, JSON.stringify({ schemaVersion: 1, icons: { 'school.fire': entry } }));
  return manifest;
}

test('card model limits untrusted fields, row count and XML markup', () => {
  const model = normalizeModel({ title: '</text><image href="file:///secret"/>', school: 'fire',
    sections: [{ title: '<script>alert(1)</script>', rows: Array.from({ length: 100 }, () => ({ label: '&bad', value: '中文'.repeat(2000), icon: '../../bad.svg' })) }] }, 4);
  assert.equal(model.sections[0].rows.length, 4);
  assert.equal(model.omitted, true);
  assert.ok(model.sections[0].rows[0].value.length <= 500);
  assert.equal(model.sections[0].rows[0].icon, '');
  const svg = createCardSvg(model);
  assert.ok(svg.includes('&lt;/text&gt;'));
  assert.ok(!svg.includes('<script>'));
  assert.ok(!svg.includes('<image '));
  assert.ok(!svg.includes('href="file:'));
  assert.ok(svg.length < 20000);
  assert.ok(Number(/height="(\d+)"/.exec(svg)[1]) <= 2470);
});

test('text card wrapping respects CJK, wide Latin text and long descriptions', () => {
  assert.deepEqual(wrapText('中文图鉴', 40, 20, 4), ['中文', '图鉴']);
  assert.deepEqual(wrapText('WWWW', 40, 20, 4), ['WW', 'WW']);
  assert.ok(wrapText('长文本'.repeat(300), 300, 24, 2)[1].endsWith('…'));
  const model = toCardModel('标题\n生命值：+100\n说明文字', { kind: 'item' });
  assert.equal(model.title, '标题');
  assert.deepEqual(model.sections[0].rows[0], { label: '生命值', value: '+100' });
});

test('actual detail and calculator pages retain 100-character rows, long stage labels and source/navigation footer', () => {
  const views = require('../lib/views.cjs');
  const { BotController } = require('../lib/bot-controller.cjs');
  const dictionary = { translate: value => ({ text: value }), stats: () => ({ entries: 0 }), dispose() {} };
  const controller = new BotController({ command: 'wiz', pageSize: 5, cooldownMs: 0, dataSource: 'local' }, dictionary, { dispose() {} });
  const session = { platform: 'qq', selfId: 'synthetic', channelId: 'layout', userId: 'tester' };
  const replies = [views.detailReply('item', '1001', { name: 'Synthetic Item', zh: '合成测试条目', school: 'fire',
    description: '这是验证多行文字完整性的合成描述。'.repeat(20) + '【尾部验证标记】' }, dictionary, {
    source: '人工合成资料供自动化测试使用', sourceUrl: 'https://example.invalid/synthetic/source/provenance-only', synthetic: true, fetchedAt: 1795360000000,
  }), controller.calculate(1000, { damage: 125, blades: '40,35', shields: '50,30', resist: 20, pierce: 65 })];
  for (const reply of replies) {
    controller.prepareReply(session, reply);
    for (let i = 1; i <= reply.pages.length; i++) {
      const page = controller.responsePage(session, i);
      const model = normalizeModel(page.card);
      const visible = createCardSvg(model).replace(/<[^>]*>/gu, '').replace(/&amp;/gu, '&').replace(/&lt;/gu, '<').replace(/&gt;/gu, '>').replace(/&quot;/gu, '"').replace(/&apos;/gu, "'").replace(/\s/gu, '');
      for (const section of model.sections) for (const row of section.rows) {
        assert.ok(visible.includes(row.value.replace(/\s/gu, '')), `Value omitted on page ${i}: ${row.value}`);
        assert.ok(visible.includes(row.label.replace(/\s/gu, '')), `Label omitted on page ${i}: ${row.label}`);
      }
      assert.ok(visible.includes(model.footer.replace(/\s/gu, '')), `Source/navigation omitted on page ${i}`);
    }
  }
  controller.dispose();
});

test('missing or non-CJK font produces a recognizable error without server paths', async t => {
  const directory = await temporary(t);
  const file = path.join(directory, 'fake-noto.ttf');
  await fs.writeFile(file, Buffer.from('Not a font'));
  const renderer = new CardRenderer({ fontPath: file });
  assert.equal(inspectFont(Buffer.from('Not a font')), null);
  await assert.rejects(renderer.render({ title: '中文' }), error => error.code === 'WIZ_CARD_UNAVAILABLE' && error.reason === 'missing-cjk-font' && !error.message.includes(directory));
  assert.equal(renderer.status().fontAvailable, false);
  assert.ok(!JSON.stringify(renderer.status()).includes(directory));
  renderer.dispose();
});

test('icon manifest rejects path traversal, external URLs and SVG disguised as PNG', async t => {
  const directory = await temporary(t);
  for (const file of ['../outside.png', 'https://example.invalid/icon.png', '/tmp/outside.png']) {
    const manifest = await catalog(directory, { file });
    const renderer = new CardRenderer({ iconPath: manifest, fontPath: 'missing-cjk-font.ttf' });
    await renderer.initialize();
    assert.equal(renderer.status().iconCount, 0);
    assert.equal(renderer.status().iconIssue, 'invalid-icon-catalog');
    renderer.dispose();
  }
  const manifest = await catalog(directory);
  await fs.writeFile(path.join(directory, 'icon.png'), '<svg xmlns="http://www.w3.org/2000/svg"><image href="file:///secret"/></svg>');
  const renderer = new CardRenderer({ iconPath: manifest, fontPath: 'missing-cjk-font.ttf' });
  await renderer.initialize();
  assert.equal(renderer.status().iconCount, 0);
  assert.equal(renderer.status().iconIssue, 'invalid-icon-catalog');
  renderer.dispose();
});

test('icon loader verifies bounds and optional SHA-256 integrity', async t => {
  const directory = await temporary(t);
  const manifest = await catalog(directory, { file: 'icon.png', sha256: '0'.repeat(64) });
  const renderer = new CardRenderer({ iconPath: manifest, fontPath: 'missing-cjk-font.ttf' });
  await renderer.initialize();
  assert.equal(renderer.status().iconIssue, 'invalid-icon-catalog');
  renderer.dispose();
  const large = png(); large.writeUInt32BE(200000, 16);
  assert.equal(pngDimensions(large), null);
  assert.deepEqual(pngDimensions(png()), { width: 4, height: 4 });
});

test('icon symlinks cannot leave the catalog directory', async t => {
  if (process.platform === 'win32') return t.skip('Creating symlinks requires Windows developer permissions.');
  const directory = await temporary(t), inner = path.join(directory, 'icons');
  await fs.mkdir(inner); await fs.writeFile(path.join(directory, 'outside.png'), png());
  await fs.symlink(path.join(directory, 'outside.png'), path.join(inner, 'icon.png'));
  const manifest = path.join(inner, 'manifest.json');
  await fs.writeFile(manifest, JSON.stringify({ schemaVersion: 1, icons: { 'school.fire': { file: 'icon.png' } } }));
  const renderer = new CardRenderer({ iconPath: manifest, fontPath: 'missing-cjk-font.ttf' });
  await renderer.initialize();
  assert.equal(renderer.status().iconIssue, 'invalid-icon-catalog');
  renderer.dispose();
});

test('renderer emits a bounded PNG with Chinese text and locally supplied synthetic icon', async t => {
  const directory = await temporary(t);
  const renderer = new CardRenderer({ iconPath: await catalog(directory), fontPath: process.env.WIZ_TEST_CJK_FONT });
  t.after(() => renderer.dispose());
  await renderer.initialize();
  if (!renderer.status().fontAvailable) return t.skip('Install fonts-noto-cjk or set WIZ_TEST_CJK_FONT for the PNG integration test.');
  const model = { kind: 'item', title: '中文图片卡片与繁體圖鑑', subtitle: 'Synthetic fixture, not a game item', school: 'fire',
    sections: [{ title: '属性', rows: [{ label: '生命值', value: '+100', icon: 'school.fire' }] }], footer: '仅用于自动化验证' };
  const output = await renderer.render(model);
  assert.ok(Buffer.isBuffer(output));
  assert.ok(output.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])));
  assert.equal(output.readUInt32BE(16), 900);
  assert.ok(output.readUInt32BE(20) <= 2470);
  assert.ok(output.length < 2097152);
  assert.equal(renderer.status().iconCount, 1);
  const cached = await renderer.render(model);
  assert.deepEqual(cached, output);
  cached[0] = 0;
  assert.equal((await renderer.render(model))[0], 137);
  assert.equal(renderer.status().cachedCards, 1);
});

test('oversized PNG falls back and disposal prevents more rendering', async t => {
  const renderer = new CardRenderer({ maxImageBytes: 32768, fontPath: process.env.WIZ_TEST_CJK_FONT });
  await renderer.initialize();
  if (!renderer.status().fontAvailable) { renderer.dispose(); return t.skip('CJK font required for byte-limit integration test.'); }
  await assert.rejects(renderer.render({ title: '中文图鉴', sections: [{ title: '很多信息', rows: Array.from({ length: 28 }, (_, index) => ({ label: '测试行' + index, value: '不同文字属性与英文 Mixed text ' + index })) }] }), error => error.code === 'WIZ_CARD_UNAVAILABLE' && error.reason === 'image-too-large');
  renderer.dispose();
  assert.equal(renderer.status().cachedCards, 0);
  await assert.rejects(renderer.render({ title: '中文' }), error => error.reason === 'disposed');
});
