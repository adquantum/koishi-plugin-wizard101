#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
let count = 0;
function visit(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) visit(filename);
    else if (entry.isFile() && entry.name.endsWith('.cjs')) {
      const result = spawnSync(process.execPath, ['--check', filename], { stdio: 'inherit' });
      if (result.status !== 0) process.exit(result.status || 1);
      count++;
    }
  }
}
for (const directory of ['lib', 'tools', 'test']) visit(path.join(root, directory));
console.log(`语法检查通过：${count} 个 CommonJS 文件。`);
