'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { CardRenderer, BUNDLED_ICON_PATH, createCardSvg } = require('../lib/cards.cjs');
const { entityRows } = require('../lib/views.cjs');

const ROOT = path.resolve(__dirname, '..');
const manifest = require('../assets/icons/manifest.json');

async function temporary(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wiz-bundled-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

test('all bundled original PNGs match their manifest and default rendering loads their semantic keys', async () => {
  assert.equal(manifest.files.length, 323);
  assert.equal(Object.keys(manifest.icons).length, 415);
  assert.equal(manifest.semanticIconCount, 92);
  let bytes = 0;
  for (const entry of manifest.files) {
    const png = await fs.readFile(path.resolve(path.dirname(BUNDLED_ICON_PATH), entry.file));
    assert.equal(crypto.createHash('sha256').update(png).digest('hex'), entry.sha256);
    assert.equal(png.readUInt32BE(16), entry.width);
    assert.equal(png.readUInt32BE(20), entry.height);
    bytes += png.length;
  }
  assert.ok(bytes < 2 * 1024 * 1024);
  const renderer = new CardRenderer();
  try {
    await renderer.initialize();
    assert.equal(renderer.status().iconSource, 'bundled');
    assert.equal(renderer.status().iconIssue, null);
    assert.equal(renderer.status().iconCount, 415);
    for (const key of ['school.fire', 'school.ice', 'school.gardening', 'school.fishing', 'school.cantrips', 'stat.health', 'stat.damage', 'stat.flat_damage', 'stat.resist', 'stat.flat_resist', 'pip.normal', 'pet.strength', 'socket.circle']) {
      assert.match(renderer.icons.get(key), /^data:image\/png;base64,/, key);
    }
    const rows = entityRows({ spell_accuracy: '75%', rank_label: '4' }, { translate: text => ({ text }) });
    assert.deepEqual(rows.map(row => row.icon), ['stat.accuracy', 'pip.normal']);
    const svg = createCardSvg({ kind: 'spell', title: '随包图标检查', school: 'fire', sections: [{ title: '属性', rows }] }, renderer.icons);
    assert.ok(svg.includes(renderer.icons.get('school.fire')));
    assert.ok(svg.includes(renderer.icons.get('stat.accuracy')));
    assert.ok(svg.includes(renderer.icons.get('pip.normal')));
  } finally { renderer.dispose(); }
});

test('automatic local overrides fall back to bundled icons while explicit custom choices remain authoritative', async t => {
  const dir = await temporary(t);
  const source = manifest.icons['school.fire'];
  await fs.copyFile(path.resolve(path.dirname(BUNDLED_ICON_PATH), source.file), path.join(dir, 'fire.png'));
  const local = path.join(dir, 'manifest.json');
  await fs.writeFile(local, JSON.stringify({ schemaVersion: 1, icons: { 'school.fire': { ...source, file: 'fire.png' } } }));
  for (const [options, expectedSource] of [[{ localIconPath: local }, 'local'], [{ iconPath: local }, 'custom']]) {
    const renderer = new CardRenderer(options);
    await renderer.initialize();
    assert.equal(renderer.status().iconSource, expectedSource);
    assert.equal(renderer.status().iconCount, 1);
    renderer.dispose();
  }
  await fs.writeFile(local, '{broken JSON');
  for (const filename of [local, path.join(dir, 'absent.json')]) {
    const renderer = new CardRenderer({ localIconPath: filename });
    await renderer.initialize();
    assert.equal(renderer.status().iconSource, 'bundled');
    assert.equal(renderer.status().iconCount, 415);
    assert.equal(renderer.status().iconIssue, filename === local ? 'invalid-local-icon-catalog' : null);
    renderer.dispose();
  }
  const explicit = new CardRenderer({ iconPath: local });
  await explicit.initialize();
  assert.equal(explicit.status().iconSource, null);
  assert.equal(explicit.status().iconCount, 0);
  assert.equal(explicit.status().iconIssue, 'invalid-icon-catalog');
  explicit.dispose();
  await fs.writeFile(local, JSON.stringify({ schemaVersion: 1, icons: {} }));
  const empty = new CardRenderer({ localIconPath: local });
  await empty.initialize();
  assert.equal(empty.status().iconSource, 'bundled');
  assert.equal(empty.status().iconCount, 415);
  assert.equal(empty.status().iconIssue, 'invalid-local-icon-catalog');
  empty.dispose();
});

test('the packed npm artifact renders with bundled originals from an unrelated application directory', async t => {
  const dir = await temporary(t);
  const npmCli = process.env.npm_execpath;
  const args = ['pack', '--ignore-scripts', '--json', '--pack-destination', dir];
  const packed = npmCli && /\.[cm]?js$/i.test(npmCli)
    ? spawnSync(process.execPath, [npmCli, ...args], { cwd: ROOT, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 })
    : spawnSync('npm', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, shell: process.platform === 'win32' });
  assert.equal(packed.status, 0, packed.stderr);
  const metadata = JSON.parse(packed.stdout)[0];
  assert.ok(metadata.files.some(file => file.path === 'assets/icons/manifest.json'));
  assert.equal(metadata.files.filter(file => /^assets\/icons\/png\/.*\.png$/.test(file.path)).length, 323);
  assert.ok(metadata.files.some(file => file.path === 'assets/icons/README.md'));
  const installed = path.join(dir, 'installed');
  const app = path.join(dir, 'application-without-assets');
  await fs.mkdir(installed);
  await fs.mkdir(app);
  const extracted = spawnSync(process.env.PYTHON || process.env.WIZARD101_TEST_PYTHON || 'python3', ['-c', 'import tarfile,sys\nwith tarfile.open(sys.argv[1]) as package:\n package.extractall(sys.argv[2])', path.join(dir, metadata.filename), installed], { encoding: 'utf8' });
  assert.equal(extracted.status, 0, extracted.stderr);
  const probe = String.raw`
const assert=require('node:assert/strict');
const {CardRenderer,createCardSvg}=require(process.argv[1]);
(async()=>{
 const renderer=new CardRenderer({fontPath:process.env.WIZ_TEST_CJK_FONT});
 await renderer.initialize();
 const status=renderer.status();
 assert.equal(status.iconSource,'bundled');
 assert.equal(status.iconCount,415);
 const model={kind:'item',title:'安装包中文图标验证',school:'fire',sections:[{title:'合成测试属性',rows:[{label:'生命值',value:'100',icon:'stat.health'},{label:'伤害',value:'20%',icon:'stat.damage'}]}]};
 const svg=createCardSvg(model,renderer.icons);
 assert.ok(svg.includes(renderer.icons.get('stat.health')));
 let bytes=0;
 if(status.fontAvailable&&status.rendererAvailable){const png=await renderer.render(model);assert.equal(png.readUInt32BE(16),900);bytes=png.length;assert.ok(bytes>1000);}
 renderer.dispose();
 console.log(JSON.stringify({icons:status.iconCount,source:status.iconSource,bytes,font:status.fontAvailable,native:status.rendererAvailable}));
})().catch(error=>{console.error(error);process.exitCode=1});`;
  const child = spawnSync(process.execPath, ['-e', probe, path.join(installed, 'package/lib/cards.cjs')], {
    cwd: app, env: { ...process.env, NODE_PATH: path.join(ROOT, 'node_modules') }, encoding: 'utf8', maxBuffer: 1024 * 1024,
  });
  assert.equal(child.status, 0, child.stderr);
  const result = JSON.parse(child.stdout);
  assert.equal(result.icons, 415);
  assert.equal(result.source, 'bundled');
  if (!result.font || !result.native) return t.skip('Package resources passed; install CJK font and resvg to verify raster output.');
  assert.ok(result.bytes > 1000);
});
