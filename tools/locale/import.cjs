#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { readInput } = require('./format.cjs');

function main(argv = process.argv.slice(2)) {
  const options = {};
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      process.stdout.write('Usage: node tools/locale/import.cjs --input <file.wad|file.lang|directory> --output <index.json|index.json.gz> [--strict-crc]\n');
      return;
    }
    if (arg === '--strict-crc') { options.strictCrc = true; continue; }
    if (arg !== '--input' && arg !== '--output') throw new Error(`Unknown argument: ${arg}`);
    const value = argv[++index];
    if (!value || value.startsWith('--')) throw new Error(`Missing value: ${arg}`);
    options[arg.slice(2)] = value;
  }
  if (!options.input || !options.output) throw new Error('Both --input and --output are required; see --help');
  const input = path.resolve(options.input);
  const output = path.resolve(options.output);
  if (input === output) throw new Error('Output must not replace the original input');
  if (!/\.json(?:\.gz)?$/iu.test(output)) throw new Error('Output must end with .json or .json.gz');
  const index = readInput(input, { strictCrc: options.strictCrc });
  const json = Buffer.from(JSON.stringify(index), 'utf8');
  const content = /\.gz$/iu.test(output) ? zlib.gzipSync(json, { level: 9 }) : json;
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const temporary = `${output}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporary, content, { flag: 'wx' });
    fs.renameSync(temporary, output);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
  process.stdout.write(`${JSON.stringify({ output, outputBytes: content.length, jsonBytes: json.length, source: index.source, stats: index.stats }, null, 2)}\n`);
  if (index.stats.crcMismatches) {
    process.stderr.write(`Note: ${index.stats.crcMismatches} LANG members have stored checksums that differ from standard CRC32. Structural, encoding, decompression, and size checks passed. Use --strict-crc to reject these archives.\n`);
  }
}

if (require.main === module) {
  try { main(); } catch (error) {
    process.stderr.write(`Locale import failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { main };
