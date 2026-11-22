'use strict';

const fs = require('node:fs/promises');
const zlib = require('node:zlib');

const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_ROWS = 1000000;
const MAX_FILES = 100000;
const MAX_SHORT_TEXT = 200;
const MAX_QUERY_LENGTH = 500;
const MAX_ALIASES = 1000;
const MAX_ALIAS_TARGETS = 10;
const HAS_HAN = /\p{Script=Han}/u;

function ownObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function safePath(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 4096
    && !/[\\\u0000-\u001f\u007f]/u.test(value) && !/^(?:\/|[A-Za-z]:)/u.test(value)
    && value.split('/').every(part => part && part !== '.' && part !== '..');
}

function cleanForSearch(value) {
  return value.replace(/<[^>]{0,256}>/gu, ' ')
    .replace(/\\(?:r\\n|n|r)/gu, ' ').replace(/[\r\n\t]/gu, ' ');
}

function createConverter(custom) {
  if (custom !== undefined) {
    if (typeof custom !== 'function') throw new TypeError('convert must be a function');
    if (typeof custom('汉字漢字') !== 'string') throw new TypeError('convert must return a string');
    return { convert: custom, label: 'custom', available: true };
  }
  try {
    const opencc = require('opencc-js');
    if (typeof opencc.Converter !== 'function') throw new Error('Missing Converter');
    return { convert: opencc.Converter({ from: 'tw', to: 'cn' }), label: 'opencc-tw-cn', available: true };
  } catch {
    return { convert: value => value, label: 'identity', available: false };
  }
}

function validateData(data) {
  if (!ownObject(data) || data.schemaVersion !== 1) throw new Error('Unsupported locale dictionary schemaVersion');
  if (!Array.isArray(data.files) || data.files.length > MAX_FILES) throw new Error('Invalid locale files array');
  if (!Array.isArray(data.entries) || data.entries.length > MAX_ROWS) throw new Error('Invalid locale entries array or row limit exceeded');
  let characters = 0;
  const paths = new Set();
  for (const file of data.files) {
    if (!ownObject(file) || !safePath(file.path) || typeof file.table !== 'string' || !file.table.trim()
      || file.table.length > 1024 || /[\u0000-\u001f\u007f]/u.test(file.table)) {
      throw new Error('Invalid locale file descriptor');
    }
    if (file.records !== undefined && (!Number.isSafeInteger(file.records) || file.records < 0 || file.records > MAX_ROWS)) {
      throw new Error('Invalid locale file record count');
    }
    if (paths.has(file.path)) throw new Error(`Duplicate locale file path: ${file.path}`);
    paths.add(file.path);
    characters += file.path.length + file.table.length;
  }
  for (const row of data.entries) {
    if (!Array.isArray(row) || row.length !== 4 || !Number.isSafeInteger(row[0])
      || row[0] < 0 || row[0] >= data.files.length) throw new Error('Invalid locale row file reference');
    if (typeof row[1] !== 'string' || !row[1].trim() || row[1].length > 4096
      || /[\u0000-\u001f\u007f]/u.test(row[1])) throw new Error('Invalid locale row key');
    for (const field of row.slice(2)) {
      if (typeof field !== 'string' || field.length > 1024 * 1024 || field.includes('\0')) {
        throw new Error('Invalid locale row text');
      }
    }
    characters += row[1].length + row[2].length + row[3].length;
    if (characters > MAX_FILE_BYTES) throw new Error('Locale string budget exceeded');
  }
}

function addIndex(map, term, row) {
  if (!term) return;
  const previous = map.get(term);
  if (previous === undefined) map.set(term, row);
  else if (typeof previous === 'number') {
    if (previous !== row) map.set(term, [previous, row]);
  } else if (previous.at(-1) !== row) previous.push(row);
}

function indices(value) {
  return value === undefined ? [] : typeof value === 'number' ? [value] : value;
}

function boundedNumber(value, fallback, maximum) {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) throw new RangeError(`Invalid result bound: ${value}`);
  return value;
}

class LocaleDictionary {
  constructor(data, { aliases = {}, convert } = {}) {
    validateData(data);
    const converter = createConverter(convert);
    this._convert = converter.convert;
    this._data = data;
    this._index = new Map();
    this._fileLookup = new Map();
    this._fileRows = Array.from({ length: data.files.length }, () => []);
    this._longRows = [];
    this._aliases = new Map();
    this._disposed = false;
    this._stats = {
      entries: data.entries.length, langFiles: data.files.length, sourceEntries: 0,
      localizedEntries: 0, chineseEntries: 0, bilingualEntries: 0,
      emptySourceEntries: 0, emptyTargetEntries: 0, indexedRows: 0, indexedTerms: 0,
      longTextRows: 0, shortNameMaxLength: MAX_SHORT_TEXT,
      scriptConversion: converter.available, scriptConversionMode: converter.label,
      aliases: 0, fullTextRequiresOptIn: true,
    };
    if (ownObject(data.stats)) {
      for (const key of ['duplicateTableRefs', 'duplicateFileRefs', 'englishAmbiguities', 'chineseAmbiguities', 'uncompressedLangBytes', 'crcMismatches']) {
        const value = data.stats[key];
        if (Number.isSafeInteger(value) && value >= 0) this._stats[key] = value;
      }
    }
    for (let fileIndex = 0; fileIndex < data.files.length; fileIndex++) {
      const file = data.files[fileIndex];
      for (const name of new Set([file.path, file.path.split('/').at(-1), file.table])) {
        const key = name.normalize('NFKC').toLocaleLowerCase('en-US');
        let values = this._fileLookup.get(key);
        if (!values) this._fileLookup.set(key, values = []);
        if (!values.includes(fileIndex)) values.push(fileIndex);
      }
    }
    for (let rowIndex = 0; rowIndex < data.entries.length; rowIndex++) {
      const row = data.entries[rowIndex];
      this._fileRows[row[0]].push(rowIndex);
      const source = Boolean(row[2].trim());
      const target = Boolean(row[3].trim());
      const chinese = HAS_HAN.test(row[3]);
      this._stats.sourceEntries += Number(source);
      this._stats.localizedEntries += Number(target);
      this._stats.chineseEntries += Number(chinese);
      this._stats.bilingualEntries += Number(source && chinese);
      this._stats.emptySourceEntries += Number(!source);
      this._stats.emptyTargetEntries += Number(!target);
      let indexed = false;
      let long = false;
      const forms = new Set();
      for (const value of [row[2], row[3]]) {
        if (value.length > MAX_SHORT_TEXT) { long = true; continue; }
        for (const form of this._forms(value)) {
          if (form) { forms.add(form); indexed = true; }
        }
      }
      for (const form of forms) addIndex(this._index, form, rowIndex);
      if (long) this._longRows.push(rowIndex);
      this._stats.indexedRows += Number(indexed);
    }
    this._stats.indexedTerms = this._index.size;
    this._stats.longTextRows = this._longRows.length;
    this._loadAliases(aliases);
  }

  static async load(filePath, options = {}) {
    const stat = await fs.stat(filePath);
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) throw new Error('Locale file is not regular or exceeds 64 MiB');
    let bytes = await fs.readFile(filePath);
    if (bytes.length > MAX_FILE_BYTES) throw new Error('Locale file exceeds 64 MiB');
    if ((bytes[0] === 0x1f && bytes[1] === 0x8b) || /\.gz$/iu.test(filePath)) {
      try { bytes = zlib.gunzipSync(bytes, { maxOutputLength: MAX_FILE_BYTES }); }
      catch (error) { throw new Error('Invalid or oversized locale gzip data', { cause: error }); }
    }
    if (bytes.length > MAX_FILE_BYTES) throw new Error('Locale JSON exceeds 64 MiB');
    let data;
    try { data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
    catch (error) { throw new Error('Invalid UTF-8 locale JSON', { cause: error }); }
    return new LocaleDictionary(data, options);
  }

  _assertActive() {
    if (this._disposed) throw new Error('Locale dictionary has been disposed');
  }

  _normalize(value) {
    return this._convert(cleanForSearch(value).normalize('NFKC'))
      .trim().replace(/\s+/gu, ' ').toLocaleLowerCase('en-US');
  }

  _forms(value) {
    const forms = new Set([this._normalize(value)]);
    // Some nameplates append their unchanged English name after a literal \n.
    // Index each short line as a candidate, while retaining the original row.
    const lines = value.split(/\\r\\n|\\n|[\r\n]+/gu);
    if (lines.length > 1 && lines.length <= 4) {
      for (const line of lines) if (line.trim()) forms.add(this._normalize(line));
    }
    return forms;
  }

  _query(value) {
    if (typeof value !== 'string') throw new TypeError('Query must be a string');
    if (value.length > MAX_QUERY_LENGTH || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value)) {
      throw new Error('Query is too long or contains invalid control characters');
    }
    return this._normalize(value);
  }

  _loadAliases(aliases) {
    if (!ownObject(aliases) || Object.keys(aliases).length > MAX_ALIASES) throw new Error('Invalid aliases or more than 1,000 aliases');
    for (const [key, raw] of Object.entries(aliases)) {
      if (!key.trim() || key.length > MAX_SHORT_TEXT) throw new Error('Invalid alias name');
      const values = typeof raw === 'string' ? [raw] : raw;
      if (!Array.isArray(values) || !values.length || values.length > MAX_ALIAS_TARGETS) throw new Error(`Invalid alias targets: ${key}`);
      const unique = new Map();
      for (const value of values) {
        if (typeof value !== 'string' || !value.trim() || value.length > MAX_SHORT_TEXT
          || HAS_HAN.test(value) || /[<>\u0000-\u001f\u007f]/u.test(value)) throw new Error(`Invalid English alias target: ${key}`);
        unique.set(this._normalize(value), value.trim());
      }
      const normalized = this._query(key);
      if (!normalized || this._aliases.has(normalized)) throw new Error(`Duplicate normalized alias: ${key}`);
      this._aliases.set(normalized, [...unique.values()]);
    }
    this._stats.aliases = this._aliases.size;
  }

  _row(index) {
    const [fileIndex, key, en, zh] = this._data.entries[index];
    const file = this._data.files[fileIndex].path;
    return { file, key, en, zh, ref: `${file}:${key}` };
  }

  _referenceRows(query) {
    const colon = query.indexOf(':');
    if (colon < 1) return [];
    const fileName = query.slice(0, colon).replace(/\\/gu, '/').normalize('NFKC').toLocaleLowerCase('en-US');
    const key = query.slice(colon + 1);
    const fileIndices = this._fileLookup.get(fileName);
    if (!fileIndices) return [];
    const matches = [];
    for (const fileIndex of fileIndices) {
      for (const rowIndex of this._fileRows[fileIndex]) {
        if (this._data.entries[rowIndex][1] === key) matches.push(rowIndex);
      }
    }
    return matches;
  }

  _exactRows(query, normalized) {
    const refs = this._referenceRows(query);
    return refs.length ? refs : indices(this._index.get(normalized));
  }

  find(query, { limit = 8, offset = 0, exact = false, includeLongText = false } = {}) {
    this._assertActive();
    limit = boundedNumber(limit, 8, 100);
    offset = boundedNumber(offset, 0, MAX_ROWS);
    const normalized = this._query(query);
    if (!normalized) return { rows: [], total: 0, exact: false };
    const refRows = this._referenceRows(query);
    if (refRows.length) return { rows: refRows.slice(offset, offset + limit).map(index => this._row(index)), total: refRows.length, exact: true };
    const found = new Map();
    for (const index of indices(this._index.get(normalized))) found.set(index, 0);
    let exactMatch = found.size > 0;
    if (!exact) {
      for (const [term, matches] of this._index) {
        if (term === normalized) continue;
        const rank = term.startsWith(normalized) ? 1 : term.includes(normalized) ? 2 : -1;
        if (rank < 0) continue;
        for (const index of indices(matches)) {
          if (!found.has(index) || rank < found.get(index)) found.set(index, rank);
        }
      }
    }
    if (includeLongText) {
      for (const index of this._longRows) {
        const row = this._data.entries[index];
        for (const value of [row[2], row[3]]) {
          if (value.length <= MAX_SHORT_TEXT) continue;
          const term = this._normalize(value);
          const rank = term === normalized ? 0 : exact ? -1 : term.startsWith(normalized) ? 1 : term.includes(normalized) ? 2 : -1;
          if (rank < 0) continue;
          if (rank === 0) exactMatch = true;
          if (!found.has(index) || rank < found.get(index)) found.set(index, rank);
        }
      }
    }
    const ordered = [...found].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
    return { rows: ordered.slice(offset, offset + limit).map(([index]) => this._row(index)), total: ordered.length, exact: exactMatch };
  }

  resolve(query, { limit = 5 } = {}) {
    this._assertActive();
    limit = boundedNumber(limit, 5, MAX_ALIAS_TARGETS);
    const normalized = this._query(query);
    if (!normalized) return { queries: [], ambiguous: false, matched: false, candidates: [] };
    const aliases = this._aliases.get(normalized);
    if (aliases) {
      const candidates = [];
      const seen = new Set();
      if (limit === 0) return { queries: [], ambiguous: aliases.length > 1, matched: true, candidates };
      for (const alias of aliases) {
        for (const index of indices(this._index.get(this._normalize(alias)))) {
          if (!seen.has(index)) { seen.add(index); candidates.push(this._row(index)); }
          if (candidates.length >= limit) break;
        }
        if (candidates.length >= limit) break;
      }
      return { queries: aliases.slice(0, limit), ambiguous: aliases.length > 1, matched: true, candidates };
    }
    const matches = this._exactRows(query, normalized);
    const english = new Map();
    for (const index of matches) {
      const value = cleanForSearch(this._data.entries[index][2]).trim().replace(/\s+/gu, ' ');
      if (!value || value.length > MAX_SHORT_TEXT || HAS_HAN.test(value) || !/[A-Za-z]/u.test(value)) continue;
      if (!english.has(this._normalize(value))) english.set(this._normalize(value), value);
    }
    if (matches.length) {
      return { queries: [...english.values()].slice(0, limit), ambiguous: english.size > 1, matched: true, candidates: matches.slice(0, limit).map(index => this._row(index)) };
    }
    const suggestions = this.find(query, { limit }).rows;
    // Never guess an English entity from the first fuzzy Chinese candidate.
    const queries = HAS_HAN.test(query) || query.includes(':') ? [] : [query.trim()];
    return { queries, ambiguous: false, matched: false, candidates: suggestions };
  }

  translate(english, ref) {
    this._assertActive();
    if (typeof english !== 'string') throw new TypeError('English text must be a string');
    if (!english.trim() || english.length > MAX_SHORT_TEXT) return { text: english, translated: false, ambiguous: false, candidates: [] };
    const normalized = this._normalize(english);
    const matches = ref ? this._referenceRows(String(ref)) : indices(this._index.get(normalized));
    const translations = new Map();
    for (const index of matches) {
      const row = this._data.entries[index];
      const originalMatches = this._forms(row[2]).has(normalized);
      if (!originalMatches && !(ref && !row[2].trim())) continue;
      if (!HAS_HAN.test(row[3])) continue;
      let translated = row[3].trim();
      const lines = translated.split(/\\r\\n|\\n|[\r\n]+/gu).filter(value => value.trim());
      if (lines.length > 1 && HAS_HAN.test(lines[0]) && lines.slice(1).every(value => this._normalize(value) === normalized)) translated = lines[0].trim();
      const key = this._normalize(translated);
      if (!translations.has(key)) translations.set(key, translated);
    }
    const candidates = [...translations.values()];
    if (candidates.length === 1) return { text: candidates[0], translated: true, ambiguous: false, candidates };
    return { text: english, translated: false, ambiguous: candidates.length > 1, candidates: candidates.slice(0, 10) };
  }

  stats() {
    return { ...this._stats, disposed: this._disposed };
  }

  dispose() {
    this._index.clear();
    this._fileLookup.clear();
    this._aliases.clear();
    this._fileRows = [];
    this._longRows = [];
    this._data = null;
    this._disposed = true;
  }
}

module.exports = { LocaleDictionary, MAX_FILE_BYTES, MAX_SHORT_TEXT };
