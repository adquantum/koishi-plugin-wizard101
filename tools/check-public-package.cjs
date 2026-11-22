#!/usr/bin/env node
'use strict';

const { execFileSync } = require('node:child_process');
const path = require('node:path');

function check(paths) {
  const forbidden = paths.filter(file => {
    const name = file.replaceAll('\\', '/');
    if (/\.(?:wad|lang|dds|tga|db|sqlite|sqlite3|ttf|otf|ttc|pem|key|pyc)$/i.test(name)) return true;
    if (/(?:^|\/)(?:node_modules|reports|notes|local)\//.test(name)) return true;
    if (/(?:^|\/)\.env(?:\.|$)/.test(name)) return true;
    if (/(?:^|\/)[^/]*probe[^/]*\.json$/i.test(name)) return true;
    if (name.startsWith('data/') && !['data/README.md', 'data/locale-example.json', 'data/catalog-example.json'].includes(name)) return true;
    return /locale-zh.*\.json(?:\.gz)?$/i.test(name);
  });
  if (forbidden.length) throw new Error(`公开包含有不应分发的数据文件：\n${forbidden.join('\n')}`);
  for (const required of ['README.md', 'LICENSE', 'lib/index.cjs', 'lib/cards.cjs', 'lib/platform.cjs', 'tools/locale/import.cjs', 'tools/icons/import.py', 'tools/catalog/from-sqlite.py', 'data/locale-example.json', 'data/catalog-example.json']) {
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
  console.log(`公开包检查通过：${count} 个文件，无原始游戏图标/数据库、完整词典、私有字体或联调报告。`);
}

if (require.main === module) {
  try { main(); }
  catch (error) { console.error(error.message || '公开包检查失败。'); process.exitCode = 1; }
}
module.exports = { check };
