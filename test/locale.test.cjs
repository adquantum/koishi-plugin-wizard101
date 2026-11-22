'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { spawnSync } = require('node:child_process');
const { safeArchivePath, crc32, readLang, parseWad, buildIndex, readInput } = require('../tools/locale/format.cjs');

function lang(text = '1:Spell\r\n00000001\r\nFire Cat\r\n火猫\r\n') {
  return Buffer.from(`\uFEFF${text}`, 'utf16le');
}

function makeWad(files, version = 1) {
  const header = Buffer.alloc(version === 2 ? 14 : 13);
  header.write('KIWAD', 'ascii');
  header.writeUInt32LE(version, 5);
  header.writeUInt32LE(files.length, 9);
  const entries = files.map(file => {
    const name = Buffer.from(`${file.name}\0`, 'utf8');
    const raw = file.data || lang();
    const stored = file.compressed ? zlib.deflateSync(raw) : raw;
    const metadata = Buffer.alloc(21);
    metadata.writeUInt32LE(raw.length, 4);
    metadata.writeUInt32LE(stored.length, 8);
    metadata[12] = file.compressed ? 1 : 0;
    metadata.writeUInt32LE(file.badCrc ? 0 : crc32(raw), 13);
    metadata.writeUInt32LE(name.length, 17);
    return { metadata, name, stored };
  });
  let offset = header.length + entries.reduce((size, entry) => size + 21 + entry.name.length, 0);
  for (const entry of entries) { entry.metadata.writeUInt32LE(offset, 0); offset += entry.stored.length; }
  return Buffer.concat([header, ...entries.flatMap(entry => [entry.metadata, entry.name]), ...entries.map(entry => entry.stored)]);
}

test('CRC32 matches the published standard check value', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
});

test('LANG reader preserves empty fields, leading zero keys and literal escaped newlines', () => {
  const parsed = readLang(lang('1:Spell\r\n00000001\r\nFire Cat\r\n火猫\\nFire Cat\r\n00000002\r\n\r\n\r\n'), 'Locale/en-US/Spell.lang');
  assert.equal(parsed.table, 'Spell');
  assert.deepEqual(parsed.records, [
    { key: '00000001', original: 'Fire Cat', localized: '火猫\\nFire Cat' },
    { key: '00000002', original: '', localized: '' },
  ]);
});

test('LANG reader accepts BOM-free UTF-16LE and an absent final newline', () => {
  const parsed = readLang(Buffer.from('1:Spell\nFireCat\nFire Cat\n火猫', 'utf16le'));
  assert.equal(parsed.records[0].localized, '火猫');
});

test('LANG reader rejects incorrect encoding, malformed headers, and incomplete triples', () => {
  assert.throws(() => readLang(Buffer.from([0x31])), /Odd byte length/u);
  assert.throws(() => readLang(Buffer.from([0xfe, 0xff, 0, 0x31])), /UTF-16BE/u);
  assert.throws(() => readLang(Buffer.from([0x00, 0xd8])), /Invalid UTF-16LE/u);
  assert.throws(() => readLang(lang('2:Spell\nkey\nen\nzh')), /Invalid LANG header/u);
  assert.throws(() => readLang(lang('1:Spell\nkey\nen')), /Incomplete LANG record/u);
  assert.throws(() => readLang(lang('1:Spell\n\nen\nzh')), /Invalid LANG key/u);
});

test('LANG reader enforces file and record budgets', () => {
  assert.throws(() => readLang(lang(), 'Spell.lang', { limits: { maxEntryBytes: 4 } }), /size limit/u);
  assert.throws(() => readLang(lang('1:T\na\nb\nc\nd\ne\nf'), 'T.lang', { limits: { maxEntries: 1 } }), /Too many LANG records/u);
});

test('KIWAD reader accepts compressed/uncompressed members and both known directory layouts', () => {
  for (const version of [1, 2]) {
    const wad = makeWad([
      { name: 'Locale/en-US/Spell.lang', compressed: true },
      { name: 'Locale/en-US/Other.lang' },
      { name: 'Texture.dds', data: Buffer.from('not a lang') },
    ], version);
    const parsed = parseWad(wad, { strictCrc: true });
    assert.equal(parsed.version, version);
    assert.equal(parsed.archiveFiles, 3);
    assert.equal(parsed.members.length, 2);
    assert.equal(parsed.members[0].records[0].localized, '火猫');
    assert.equal(parsed.crcMismatches, 0);
  }
});

test('KIWAD checksum mismatches are counted and strict mode rejects them', () => {
  const wad = makeWad([{ name: 'Spell.lang', badCrc: true }]);
  assert.equal(parseWad(wad).crcMismatches, 1);
  assert.throws(() => parseWad(wad, { strictCrc: true }), /CRC32 mismatch/u);
});

test('archive path validation rejects traversal, absolute paths, drive paths, and NULs', () => {
  assert.equal(safeArchivePath('Locale\\en-US\\Spell.lang'), 'Locale/en-US/Spell.lang');
  for (const name of ['../Spell.lang', 'Locale/../../Spell.lang', '/Spell.lang', 'C:\\Spell.lang', 'a//b.lang', 'a/./b.lang', 'a\0.lang']) {
    assert.throws(() => safeArchivePath(name), /path/iu);
    assert.throws(() => parseWad(makeWad([{ name }])), /filename/iu);
  }
});

test('KIWAD reader rejects duplicate member paths instead of overwriting', () => {
  assert.throws(() => parseWad(makeWad([{ name: 'Spell.lang' }, { name: 'Spell.lang' }])), /Duplicate WAD member path/u);
});

test('KIWAD reader rejects out-of-bounds members, directory overlap and truncated directories', () => {
  const wad = makeWad([{ name: 'Spell.lang' }]);
  const outOfBounds = Buffer.from(wad);
  outOfBounds.writeUInt32LE(wad.length + 1, 13);
  assert.throws(() => parseWad(outOfBounds), /out of bounds/u);
  const overlap = Buffer.from(wad);
  overlap.writeUInt32LE(14, 13);
  assert.throws(() => parseWad(overlap), /overlaps directory/u);
  assert.throws(() => parseWad(wad.subarray(0, 20)), /Truncated WAD directory/u);
});

test('KIWAD reader enforces output budgets and catches corrupt compression', () => {
  const wad = makeWad([{ name: 'Spell.lang', compressed: true }]);
  assert.throws(() => parseWad(wad, { limits: { maxTotalLangBytes: 8 } }), /Total LANG output/u);
  assert.throws(() => parseWad(wad, { limits: { maxEntryBytes: 8 } }), /size limit/u);
  const corrupted = Buffer.from(wad);
  corrupted[corrupted.readUInt32LE(13)] = 0;
  assert.throws(() => parseWad(corrupted), /inflate LANG member/u);
  const tooSmall = Buffer.from(wad);
  tooSmall.writeUInt32LE(8, 17);
  assert.throws(() => parseWad(tooSmall), /inflate LANG member/u);
});

test('index preserves ambiguous translations, duplicate file keys and table aliases', () => {
  const first = readLang(lang('1:Same\na\nDark Sprite\n黑暗精灵\na\nDark Sprite\n黑暗小妖\nb\nImp\n小精灵\nc\nPixie\n小精灵\n'), 'a.lang');
  const second = readLang(lang('1:Same\na\nFire Cat\n火猫\n'), 'b.lang');
  const index = buildIndex([first, second], { filename: 'fixture' });
  assert.equal(index.entries.length, 5);
  assert.equal(index.stats.duplicateTableRefs, 2);
  assert.equal(index.stats.duplicateFileRefs, 1);
  assert.equal(index.stats.englishAmbiguities, 1);
  assert.equal(index.stats.chineseAmbiguities, 1);
  assert.equal(index.entries[0][3], '黑暗精灵');
  assert.equal(index.entries[1][3], '黑暗小妖');
  assert.equal(index.files[index.entries[4][0]].path, 'b.lang');
});

test('recursive import handles multiple LANG files and refuses symbolic links', t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wiz-locale-test-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  fs.mkdirSync(path.join(temp, 'nested'));
  fs.writeFileSync(path.join(temp, 'a.lang'), lang());
  fs.writeFileSync(path.join(temp, 'nested/b.lang'), lang('1:Other\na\nIce\n冰霜\n'));
  const index = readInput(temp);
  assert.equal(index.stats.langFiles, 2);
  assert.equal(index.source.format, 'LANG_DIRECTORY');
  assert.equal(index.source.sha256.length, 64);
  assert.equal(index.files[1].path, 'nested/b.lang');
  if (process.platform !== 'win32') {
    fs.symlinkSync(path.join(temp, 'a.lang'), path.join(temp, 'link.lang'));
    assert.throws(() => readInput(temp), /Symbolic link rejected/u);
  }
});

test('CLI creates a reusable gzip index, preserves the source and rejects bad arguments', t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wiz-locale-cli-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const input = path.join(temp, 'Spells.lang');
  const output = path.join(temp, 'output/index.json.gz');
  const original = lang();
  fs.writeFileSync(input, original);
  const cli = path.resolve(__dirname, '../tools/locale/import.cjs');
  const result = spawnSync(process.execPath, [cli, '--input', input, '--output', output], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const index = JSON.parse(zlib.gunzipSync(fs.readFileSync(output)).toString('utf8'));
  assert.equal(index.entries[0][3], '火猫');
  assert.deepEqual(fs.readFileSync(input), original);
  const invalid = spawnSync(process.execPath, [cli, '--input', input, '--output'], { encoding: 'utf8' });
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /Missing value/u);
});
