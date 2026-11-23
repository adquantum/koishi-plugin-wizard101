#!/usr/bin/env node
'use strict';

const { execFileSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

function bundledIconPaths() {
  const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../assets/icons/manifest.json'), 'utf8'));
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.files) || !manifest.files.length) throw new Error('随包图标清单格式无效。');
  const files = manifest.files.map(entry => {
    if (!/^png\/[a-z0-9_-]+\.png$/.test(entry.file || '')) throw new Error('随包图标路径无效。');
    return 'assets/icons/' + entry.file;
  });
  const allowed = new Set(files);
  if (allowed.size !== files.length) throw new Error('随包图标清单包含重复文件。');
  for (const entry of Object.values(manifest.icons || {})) {
    if (!allowed.has('assets/icons/' + entry.file)) throw new Error('随包图标键引用了未声明的图片。');
  }
  return ['assets/icons/manifest.json', 'assets/icons/README.md', ...files];
}

function check(paths) {
  const bundledIcons = bundledIconPaths();
  const allowedIcons = new Set(bundledIcons);
  const forbidden = paths.filter(file => {
    const name = file.replaceAll('\\', '/');
    if (/\.(?:wad|lang|dds|tga|db|sqlite|sqlite3|ttf|otf|ttc|pem|key|pyc)$/i.test(name)) return true;
    if (/(?:^|\/)(?:node_modules|reports|notes|local)\//.test(name)) return true;
    if (/(?:^|\/)\.env(?:\.|$)/.test(name)) return true;
    if (/(?:^|\/)[^/]*probe[^/]*\.json$/i.test(name)) return true;
    if (name.startsWith('data/') && !['data/README.md', 'data/locale-example.json', 'data/catalog-example.json'].includes(name)) return true;
    if (name.startsWith('assets/icons/') && !allowedIcons.has(name)) return true;
    return /locale-zh.*\.json(?:\.gz)?$/i.test(name);
  });
  if (forbidden.length) throw new Error(`公开包含有不应分发的数据文件：\n${forbidden.join('\n')}`);
  for (const required of ['README.md', 'LICENSE', 'LICENSES/MIT-legacy.txt', 'lib/index.cjs', 'lib/cards.cjs', 'lib/platform.cjs', 'lib/interactions.cjs', 'lib/kimerith-controller.cjs', 'lib/kimerith-math.cjs', 'lib/kimerith-search.cjs', 'lib/kimerith-views.cjs', 'lib/portraits.cjs', 'tools/locale/import.cjs', 'tools/icons/import.py', 'tools/catalog/from-sqlite.py', 'tools/catalog/combat.py', 'tools/catalog/presentation.py', 'tools/catalog/spell_effects.py', 'test/spell-effects-fixture.py', 'docs/upstream-command-contract.json', 'data/locale-example.json', 'data/catalog-example.json', ...bundledIcons]) {
    if (!paths.includes(required)) throw new Error(`公开包缺少必需文件：${required}`);
  }
  return paths.length;
}

function main() {
  const root = path.resolve(__dirname, '..');
  const args = ['pack', '--dry-run', '--ignore-scripts', '--json'];
  const options = { cwd: root, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] };
  const npmCli = process.env.npm_execpath;
  const output = npmCli && /\.[cm]?js$/i.test(npmCli)
    ? execFileSync(process.execPath, [npmCli, ...args], options)
    : execFileSync('npm', args, { ...options, shell: process.platform === 'win32' });
  const result = JSON.parse(output);
  if (!Array.isArray(result) || result.length !== 1 || !Array.isArray(result[0].files)) throw new Error('无法读取 npm 打包清单。');
  const count = check(result[0].files.map(file => file.path));
  console.log(`公开包检查通过：${count} 个文件，包含已声明的随包 PNG 图标；不含 WAD/LANG、原始 DDS/TGA、数据库、完整词典、私有字体或联调报告。`);
}

if (require.main === module) {
  try { main(); }
  catch (error) { console.error(error.message || '公开包检查失败。'); process.exitCode = 1; }
}
module.exports = { check };
