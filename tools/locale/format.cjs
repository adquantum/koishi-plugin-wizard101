'use strict';

// This reader never extracts archive paths to the filesystem. All original
// strings and duplicate records are retained; no automatic translation occurs.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { TextDecoder } = require('node:util');

const DEFAULT_LIMITS = Object.freeze({
  maxArchiveBytes: 512 * 1024 * 1024,
  maxFiles: 100000,
  maxEntryBytes: 64 * 1024 * 1024,
  maxTotalLangBytes: 256 * 1024 * 1024,
  maxEntries: 1000000,
  maxNameBytes: 4096,
});

function limitsWith(options = {}) {
  const limits = { ...DEFAULT_LIMITS, ...(options.limits || {}) };
  for (const [key, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`Invalid limit: ${key}`);
  }
  return limits;
}

function safeArchivePath(value) {
  if (typeof value !== 'string' || !value || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error('Invalid archive path');
  }
  const normalized = value.replace(/\\/g, '/');
  if (normalized.startsWith('/') || /^[A-Za-z]:/u.test(normalized)) {
    throw new Error(`Absolute archive path rejected: ${value}`);
  }
  if (normalized.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error(`Unsafe archive path rejected: ${value}`);
  }
  return normalized;
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, i) => {
  let value = i;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function crc32(data) {
  let value = 0xffffffff;
  for (const byte of data) value = CRC_TABLE[(value ^ byte) & 255] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function readLang(buffer, sourcePath = 'input.lang', options = {}) {
  const limits = limitsWith(options);
  if (!Buffer.isBuffer(buffer)) throw new TypeError('LANG input must be a Buffer');
  if (buffer.length > limits.maxEntryBytes) throw new Error(`LANG file exceeds size limit: ${sourcePath}`);
  if (buffer.length % 2 !== 0) throw new Error(`Odd byte length for UTF-16LE: ${sourcePath}`);
  if (buffer[0] === 0xfe && buffer[1] === 0xff) throw new Error(`UTF-16BE is not supported: ${sourcePath}`);
  let text;
  try {
    text = new TextDecoder('utf-16le', { fatal: true }).decode(buffer);
  } catch (error) {
    throw new Error(`Invalid UTF-16LE data: ${sourcePath}`, { cause: error });
  }
  if (text.includes('\u0000')) throw new Error(`NUL character in LANG file: ${sourcePath}`);
  const lines = text.replace(/^\uFEFF/u, '').split(/\r\n|\n|\r/u);
  // Remove the final line terminator only. Empty source/target lines are data.
  if (lines.at(-1) === '') lines.pop();
  const header = lines.shift();
  if (typeof header !== 'string' || !header.startsWith('1:') || header.length <= 2 || header.length > 1026) {
    throw new Error(`Invalid LANG header, expected 1:table: ${sourcePath}`);
  }
  const table = header.slice(2);
  if (/[\u0000-\u001f\u007f]/u.test(table)) throw new Error(`Invalid LANG table: ${sourcePath}`);
  if (lines.length % 3 !== 0) {
    throw new Error(`Incomplete LANG record: ${sourcePath}; expected key/source/target triples`);
  }
  if (lines.length / 3 > limits.maxEntries) throw new Error(`Too many LANG records: ${sourcePath}`);
  const records = [];
  for (let index = 0; index < lines.length; index += 3) {
    const [key, original, localized] = lines.slice(index, index + 3);
    if (!key.trim() || key.length > 4096 || /[\u0000-\u001f\u007f]/u.test(key)) {
      throw new Error(`Invalid LANG key in ${sourcePath}, record ${index / 3 + 1}`);
    }
    records.push({ key, original, localized });
  }
  return { path: safeArchivePath(sourcePath), table, records, bytes: buffer.length };
}

function parseWad(buffer, options = {}) {
  const limits = limitsWith(options);
  if (!Buffer.isBuffer(buffer)) throw new TypeError('WAD input must be a Buffer');
  if (buffer.length > limits.maxArchiveBytes) throw new Error('WAD archive exceeds size limit');
  if (buffer.length < 13 || buffer.subarray(0, 5).toString('ascii') !== 'KIWAD') {
    throw new Error('Invalid KIWAD header');
  }
  const version = buffer.readUInt32LE(5);
  if (version !== 1 && version !== 2) throw new Error(`Unsupported KIWAD version: ${version}`);
  const count = buffer.readUInt32LE(9);
  if (count > limits.maxFiles) throw new Error('Too many WAD files');
  let cursor = version === 2 ? 14 : 13;
  if (cursor > buffer.length) throw new Error('Truncated WAD header');
  const names = new Set();
  const directory = [];
  const decoder = new TextDecoder('utf-8', { fatal: true });
  for (let i = 0; i < count; i++) {
    if (cursor + 21 > buffer.length) throw new Error(`Truncated WAD directory at file ${i}`);
    const offset = buffer.readUInt32LE(cursor);
    const size = buffer.readUInt32LE(cursor + 4);
    const compressedSize = buffer.readUInt32LE(cursor + 8);
    const compressed = buffer[cursor + 12];
    const checksum = buffer.readUInt32LE(cursor + 13);
    const nameLength = buffer.readUInt32LE(cursor + 17);
    cursor += 21;
    if (compressed !== 0 && compressed !== 1) throw new Error(`Invalid compression flag at file ${i}`);
    if (!nameLength || nameLength > limits.maxNameBytes || cursor + nameLength > buffer.length) {
      throw new Error(`Invalid WAD filename length at file ${i}`);
    }
    const nameBuffer = buffer.subarray(cursor, cursor + nameLength);
    if (nameBuffer.at(-1) !== 0) throw new Error(`WAD filename lacks NUL terminator at file ${i}`);
    let name;
    try {
      name = safeArchivePath(decoder.decode(nameBuffer.subarray(0, -1)));
    } catch (error) {
      throw new Error(`Invalid WAD filename at file ${i}: ${error.message}`, { cause: error });
    }
    cursor += nameLength;
    if (names.has(name)) throw new Error(`Duplicate WAD member path: ${name}`);
    names.add(name);
    const storedSize = compressed ? compressedSize : size;
    if (offset > buffer.length || storedSize > buffer.length - offset) {
      throw new Error(`WAD member is out of bounds: ${name}`);
    }
    directory.push({ path: name, offset, size, storedSize, compressed: Boolean(compressed), checksum });
  }
  const directoryEnd = cursor;
  for (const member of directory) {
    if (member.storedSize && member.offset < directoryEnd) {
      throw new Error(`WAD member overlaps directory: ${member.path}`);
    }
  }
  let totalBytes = 0;
  let totalEntries = 0;
  let crcMismatches = 0;
  const members = [];
  for (const member of directory) {
    if (!/\.lang$/iu.test(member.path)) continue;
    if (member.size > limits.maxEntryBytes) throw new Error(`WAD LANG member exceeds size limit: ${member.path}`);
    totalBytes += member.size;
    if (totalBytes > limits.maxTotalLangBytes) throw new Error('Total LANG output exceeds size limit');
    const stored = buffer.subarray(member.offset, member.offset + member.storedSize);
    let data;
    try {
      data = member.compressed
        ? zlib.inflateSync(stored, { maxOutputLength: Math.max(1, Math.min(member.size, limits.maxEntryBytes)) })
        : stored;
    } catch (error) {
      throw new Error(`Failed to inflate LANG member: ${member.path}`, { cause: error });
    }
    if (data.length !== member.size) throw new Error(`WAD uncompressed size mismatch: ${member.path}`);
    const crcMatched = crc32(data) === member.checksum;
    if (!crcMatched) {
      crcMismatches++;
      if (options.strictCrc) throw new Error(`WAD CRC32 mismatch: ${member.path}`);
    }
    const parsed = readLang(data, member.path, options);
    totalEntries += parsed.records.length;
    if (totalEntries > limits.maxEntries) throw new Error('Too many total LANG records');
    members.push({ ...parsed, compressed: member.compressed, crcMatched });
  }
  return { version, archiveFiles: count, directoryEnd, uncompressedLangBytes: totalBytes, crcMismatches, members };
}

function normalizedName(value) {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('en-US');
}

function addAlternative(map, key, value) {
  let values = map.get(key);
  if (!values) map.set(key, values = new Set());
  values.add(value);
}

function buildIndex(members, source = {}) {
  const files = [];
  const entries = [];
  const english = new Map();
  const chinese = new Map();
  const tableRefs = new Set();
  const fileRefs = new Set();
  const stats = {
    langFiles: members.length, entries: 0, sourceEntries: 0, localizedEntries: 0,
    chineseEntries: 0, bilingualEntries: 0, emptySourceEntries: 0, emptyTargetEntries: 0,
    duplicateTableRefs: 0, duplicateFileRefs: 0,
    englishAmbiguities: 0, chineseAmbiguities: 0,
    uncompressedLangBytes: 0, crcMismatches: 0,
  };
  for (const member of members) {
    const fileIndex = files.length;
    files.push({ path: member.path, table: member.table, records: member.records.length });
    stats.uncompressedLangBytes += member.bytes || 0;
    if (member.crcMatched === false) stats.crcMismatches++;
    for (const { key, original, localized } of member.records) {
      entries.push([fileIndex, key, original, localized]);
      stats.entries++;
      const hasSource = Boolean(original.trim());
      const hasTarget = Boolean(localized.trim());
      const hasChinese = /[\u3400-\u9fff]/u.test(localized);
      stats.sourceEntries += Number(hasSource);
      stats.localizedEntries += Number(hasTarget);
      stats.chineseEntries += Number(hasChinese);
      stats.bilingualEntries += Number(hasSource && hasChinese);
      stats.emptySourceEntries += Number(!hasSource);
      stats.emptyTargetEntries += Number(!hasTarget);
      const tableRef = JSON.stringify([member.table, key]);
      const fileRef = JSON.stringify([member.path, key]);
      stats.duplicateTableRefs += Number(tableRefs.has(tableRef));
      stats.duplicateFileRefs += Number(fileRefs.has(fileRef));
      tableRefs.add(tableRef);
      fileRefs.add(fileRef);
      if (hasSource && hasChinese) {
        addAlternative(english, normalizedName(original), normalizedName(localized));
        addAlternative(chinese, normalizedName(localized), normalizedName(original));
      }
    }
  }
  stats.englishAmbiguities = [...english.values()].filter(values => values.size > 1).length;
  stats.chineseAmbiguities = [...chinese.values()].filter(values => values.size > 1).length;
  return { schemaVersion: 1, source, stats, files, entries };
}

function readFileWithLimit(filename, maxBytes) {
  const stat = fs.lstatSync(filename);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Expected a regular file: ${filename}`);
  if (stat.size > maxBytes) throw new Error(`Input exceeds size limit: ${filename}`);
  const data = fs.readFileSync(filename);
  if (data.length > maxBytes) throw new Error(`Input exceeds size limit: ${filename}`);
  return data;
}

function readInput(input, options = {}) {
  const limits = limitsWith(options);
  const absolute = path.resolve(input);
  const stat = fs.lstatSync(absolute);
  if (stat.isSymbolicLink()) throw new Error('Symbolic link inputs are not supported');
  const source = { filename: path.basename(absolute), format: '', sha256: '' };
  const digest = crypto.createHash('sha256');
  if (stat.isFile() && /\.wad$/iu.test(absolute)) {
    const buffer = readFileWithLimit(absolute, limits.maxArchiveBytes);
    const wad = parseWad(buffer, options);
    source.format = 'KIWAD';
    source.version = wad.version;
    source.archiveFiles = wad.archiveFiles;
    source.sha256 = digest.update(buffer).digest('hex');
    if (!wad.members.length) throw new Error('No LANG members found in WAD');
    return buildIndex(wad.members, source);
  }
  const members = [];
  let totalBytes = 0;
  let totalEntries = 0;
  let visited = 0;
  const addFile = (absoluteFile, relativeFile) => {
    const buffer = readFileWithLimit(absoluteFile, limits.maxEntryBytes);
    totalBytes += buffer.length;
    if (totalBytes > limits.maxTotalLangBytes) throw new Error('Total LANG input exceeds size limit');
    digest.update(Buffer.from(`${relativeFile}\0${buffer.length}\0`, 'utf8')).update(buffer);
    const member = readLang(buffer, relativeFile, options);
    totalEntries += member.records.length;
    if (totalEntries > limits.maxEntries) throw new Error('Too many total LANG records');
    members.push(member);
  };
  if (stat.isFile() && /\.lang$/iu.test(absolute)) {
    source.format = 'LANG';
    addFile(absolute, path.basename(absolute));
  } else if (stat.isDirectory()) {
    source.format = 'LANG_DIRECTORY';
    const visit = (folder, relative = '') => {
      const children = fs.readdirSync(folder, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'));
      for (const child of children) {
        if (++visited > limits.maxFiles) throw new Error('Too many directory entries');
        const relativeFile = relative ? `${relative}/${child.name}` : child.name;
        const absoluteFile = path.join(folder, child.name);
        if (child.isSymbolicLink()) throw new Error(`Symbolic link rejected: ${relativeFile}`);
        if (child.isDirectory()) visit(absoluteFile, relativeFile);
        else if (child.isFile() && /\.lang$/iu.test(child.name)) addFile(absoluteFile, safeArchivePath(relativeFile));
      }
    };
    visit(absolute);
  } else {
    throw new Error('Input must be a .wad file, a .lang file, or a directory of .lang files');
  }
  if (!members.length) throw new Error('No LANG files found');
  source.sha256 = digest.digest('hex');
  source.digestScope = 'sorted relative paths, byte lengths, and raw file bytes';
  return buildIndex(members, source);
}

module.exports = { DEFAULT_LIMITS, safeArchivePath, crc32, readLang, parseWad, buildIndex, readInput, normalizedName };
