'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const python = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const pillow = spawnSync(python, ['-c', 'from PIL import Image'], { timeout: 10000, encoding: 'utf8' });
const available = pillow.status === 0;
const importer = path.resolve(__dirname, '../tools/icons/import.py');
const settings = { skip: !available && 'Install Python and Pillow to run icon-import integration tests.' };

function run(...args) { return spawnSync(python, [importer, ...args], { timeout: 20000, encoding: 'utf8' }); }
function tga() {
  const header = Buffer.alloc(18); header[2] = 2; header.writeUInt16LE(4, 12); header.writeUInt16LE(4, 14); header[16] = 32; header[17] = 0x28;
  return Buffer.concat([header, Buffer.from(Array.from({ length: 16 }, () => [20, 100, 220, 255]).flat())]);
}

async function temporary(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wiz-icon-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

test('icon importer converts synthetic TGA and maps semantic school/pip keys', settings, async t => {
  const directory = await temporary(t), source = path.join(directory, 'input'), output = path.join(directory, 'output');
  await fs.mkdir(source);
  await fs.writeFile(path.join(source, 'Icon_Fire.tga'), tga());
  await fs.writeFile(path.join(source, 'Type_Pip.tga'), tga());
  const result = run('--input', source, '--output', output);
  assert.equal(result.status, 0, result.stderr);
  const manifest = JSON.parse(await fs.readFile(path.join(output, 'manifest.json'), 'utf8'));
  assert.equal(manifest.source.fileCount, 2);
  assert.ok(manifest.icons['school.fire']);
  assert.ok(manifest.icons['pip.normal']);
  const image = await fs.readFile(path.join(output, manifest.icons['school.fire'].file));
  assert.equal(image.toString('ascii', 1, 4), 'PNG');
  assert.equal(manifest.icons['school.fire'].width, 4);
  assert.equal(manifest.icons['school.fire'].sha256.length, 64);
  const { CardRenderer } = require('../lib/cards.cjs');
  const renderer = new CardRenderer({ iconPath: path.join(output, 'manifest.json'), fontPath: 'missing-cjk-font.ttf' });
  await renderer.initialize();
  assert.equal(renderer.status().iconIssue, null);
  assert.equal(renderer.status().iconCount, Object.keys(manifest.icons).length);
  renderer.dispose();
  assert.equal(run('--input', source, '--output', output).status, 1);
  assert.equal(run('--input', source, '--output', path.join(source, 'generated')).status, 1);
});

test('icon conversion rejects all renderer output budgets atomically, including semantic aliases', settings, async t => {
  const directory = await temporary(t), source = path.join(directory, 'input');
  await fs.mkdir(source);
  await fs.writeFile(path.join(source, 'Icon_Fire.tga'), tga());
  const script = [
    'import importlib.util, pathlib, sys',
    'sys.dont_write_bytecode = True',
    'spec = importlib.util.spec_from_file_location("wizard_icon_import", sys.argv[1])',
    'module = importlib.util.module_from_spec(spec)',
    'spec.loader.exec_module(module)',
    'setattr(module, sys.argv[4], 1)',
    'try:',
    ' module.convert(pathlib.Path(sys.argv[2]), pathlib.Path(sys.argv[3]))',
    'except ValueError as error:',
    ' print(str(error), file=sys.stderr)',
    ' sys.exit(1)',
  ].join('\n');
  const limits = [
    ['MAX_ICON_BYTES', /单个 PNG/u],
    ['MAX_ICON_TOTAL', /PNG 总量/u],
    ['MAX_MANIFEST_BYTES', /manifest\.json/u],
    // One source produces asset.icon_fire.tga + school.fire; aliases count too.
    ['MAX_ICON_ENTRIES', /含原文件键与语义键/u],
  ];
  for (const [limit, message] of limits) {
    const output = path.join(directory, limit);
    const result = spawnSync(python, ['-c', script, importer, source, output, limit], { timeout: 20000, encoding: 'utf8' });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, message);
    await assert.rejects(fs.stat(output), { code: 'ENOENT' });
    assert.deepEqual((await fs.readdir(directory)).filter(name => name.startsWith('.icons-import-')), []);
  }
});

test('icon ZIP importer rejects traversal and symlink entries before publishing output', settings, async t => {
  const directory = await temporary(t);
  for (const variant of ['traversal', 'symlink']) {
    const zip = path.join(directory, variant + '.zip'), output = path.join(directory, variant + '-output');
    const make = spawnSync(python, ['-c', 'import zipfile,sys\np=sys.argv[1]; kind=sys.argv[2]\nwith zipfile.ZipFile(p,"w") as z:\n i=zipfile.ZipInfo("../escape.tga" if kind=="traversal" else "link.tga")\n if kind=="symlink": i.external_attr=(0o120777 << 16)\n z.writestr(i,b"outside")', zip, variant], { timeout: 10000, encoding: 'utf8' });
    assert.equal(make.status, 0, make.stderr);
    const result = run('--input', zip, '--output', output);
    assert.equal(result.status, 1, result.stdout);
    await assert.rejects(fs.stat(output), { code: 'ENOENT' });
  }
});

test('icon importer rejects oversized decoded dimensions and leaves no partial output', settings, async t => {
  const directory = await temporary(t), source = path.join(directory, 'input'), output = path.join(directory, 'output');
  await fs.mkdir(source);
  const huge = tga(); huge.writeUInt16LE(20000, 12); huge.writeUInt16LE(20000, 14);
  await fs.writeFile(path.join(source, 'Icon_Fire.tga'), huge);
  assert.equal(run('--input', source, '--output', output).status, 1);
  await assert.rejects(fs.stat(output), { code: 'ENOENT' });
  assert.deepEqual((await fs.readdir(directory)).filter(name => name.startsWith('.icons-import-')), []);
});
