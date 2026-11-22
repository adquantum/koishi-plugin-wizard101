'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const zlib = require('node:zlib');
const { LocaleDictionary, MAX_FILE_BYTES } = require('../lib/locale.cjs');

function fixture() {
  return {
    schemaVersion: 1,
    source: { filename: 'fixture.lang' },
    files: [{ path: 'Locale/en-US/Spells.lang', table: 'Spells' }, { path: 'Locale/en-US/Other.lang', table: 'Other' }],
    entries: [
      [0, 'FireCat', 'Fire Cat', '火猫'],
      [0, 'FireCatTreasure', 'Fire Cat Treasure Card', '火猫宝藏卡'],
      [1, 'Cat', 'Wild Fire Cat', '野生火猫'],
      [0, 'DarkSpriteA', 'Dark Sprite', '黑暗精灵'],
      [0, 'DarkSpriteB', 'Dark Sprite', '黑暗小妖'],
      [0, 'Pixie', 'Pixie', '小精灵'],
      [1, 'Sprite', 'Sprite', '小精灵'],
      [1, 'Nameplate', 'Fire Cat', '火猫\\nFire Cat'],
      [1, 'TargetOnly', '', '只有中文'],
      [1, 'EmptyTarget', 'Untranslated Item', ''],
      [1, 'Repeated', 'Repeated One', '重复一'],
      [1, 'Repeated', 'Repeated Two', '重复二'],
      [1, 'LongDialogue', 'A long dialogue '.repeat(20), '一段很长的台词'.repeat(35) + '终点提示'],
    ],
  };
}

const identity = { convert: value => value };

test('dictionary ranks exact, prefix, substring and paginates without dropping source refs', () => {
  const dictionary = new LocaleDictionary(fixture(), identity);
  const result = dictionary.find('火猫', { limit: 10 });
  assert.equal(result.exact, true);
  assert.equal(result.total, 4);
  assert.deepEqual(result.rows.map(row => row.key), ['FireCat', 'Nameplate', 'FireCatTreasure', 'Cat']);
  assert.equal(result.rows[0].ref, 'Locale/en-US/Spells.lang:FireCat');
  assert.deepEqual(dictionary.find('火猫', { limit: 1, offset: 2 }).rows.map(row => row.key), ['FireCatTreasure']);
  assert.equal(dictionary.find('火猫', { exact: true }).total, 2);
});

test('reference lookups retain key case, leading zeros, and duplicate occurrences', () => {
  const data = fixture();
  data.entries.push([0, '000001', 'Numbered', '编号']);
  const dictionary = new LocaleDictionary(data, identity);
  assert.equal(dictionary.find('Spells:000001').rows[0].key, '000001');
  assert.equal(dictionary.find('locale/en-us/spells.lang:FireCat').rows[0].en, 'Fire Cat');
  assert.equal(dictionary.find('Other:Repeated').rows.length, 2);
  assert.equal(dictionary.find('Spells:firecat', { exact: true }).total, 0);
});

test('Chinese exact resolution returns distinct English alternatives and never guesses from fuzzy text', () => {
  const dictionary = new LocaleDictionary(fixture(), identity);
  assert.deepEqual(dictionary.resolve('火猫').queries, ['Fire Cat']);
  const ambiguous = dictionary.resolve('小精灵');
  assert.equal(ambiguous.ambiguous, true);
  assert.deepEqual(ambiguous.queries, ['Pixie', 'Sprite']);
  const suggestions = dictionary.resolve('火');
  assert.equal(suggestions.matched, false);
  assert.deepEqual(suggestions.queries, []);
  assert.ok(suggestions.candidates.length > 0);
  assert.deepEqual(dictionary.resolve('Not In Dictionary').queries, ['Not In Dictionary']);
  assert.deepEqual(dictionary.resolve('Spells:Missing').queries, []);
});

test('entries lacking an English source do not acquire an invented online query', () => {
  const dictionary = new LocaleDictionary(fixture(), identity);
  const result = dictionary.resolve('只有中文');
  assert.equal(result.matched, true);
  assert.deepEqual(result.queries, []);
  assert.equal(result.candidates[0].zh, '只有中文');
});

test('translation only replaces an unambiguous target or an explicit matching source ref', () => {
  const dictionary = new LocaleDictionary(fixture(), identity);
  assert.deepEqual(dictionary.translate('Fire Cat'), { text: '火猫', translated: true, ambiguous: false, candidates: ['火猫'] });
  const ambiguous = dictionary.translate('Dark Sprite');
  assert.equal(ambiguous.text, 'Dark Sprite');
  assert.equal(ambiguous.translated, false);
  assert.equal(ambiguous.ambiguous, true);
  assert.deepEqual(ambiguous.candidates, ['黑暗精灵', '黑暗小妖']);
  assert.equal(dictionary.translate('Dark Sprite', 'Spells:DarkSpriteB').text, '黑暗小妖');
  assert.equal(dictionary.translate('Wrong English Name', 'Spells:DarkSpriteB').translated, false);
  assert.equal(dictionary.translate('New Original', 'Other:TargetOnly').text, '只有中文');
  assert.equal(dictionary.translate('Untranslated Item').translated, false);
});

test('alias resolution takes priority, preserves alternatives, and validates configured limits', () => {
  const dictionary = new LocaleDictionary(fixture(), { ...identity, aliases: { 火猫: 'Custom Fire Cat', 小精灵: ['Pixie', 'Sprite', 'pixie'] } });
  assert.deepEqual(dictionary.resolve('火猫').queries, ['Custom Fire Cat']);
  assert.equal(dictionary.resolve('小精灵', { limit: 1 }).ambiguous, true);
  assert.equal(dictionary.resolve('小精灵', { limit: 1 }).queries.length, 1);
  assert.deepEqual(dictionary.resolve('小精灵', { limit: 0 }), { queries: [], ambiguous: true, matched: true, candidates: [] });
  assert.throws(() => new LocaleDictionary(fixture(), { aliases: { bad: ['中文'] } }), /English alias target/u);
  assert.throws(() => new LocaleDictionary(fixture(), { aliases: { bad: Array(11).fill('English') } }), /Invalid alias targets/u);
  assert.throws(() => new LocaleDictionary(fixture(), { aliases: { bad: '<at id=all/>' } }), /English alias target/u);
  assert.throws(() => new LocaleDictionary(fixture(), { aliases: { A: 'One', a: 'Two' } }), /Duplicate normalized alias/u);
});

test('script conversion affects only lookup forms and leaves stored translations unchanged', () => {
  const data = fixture();
  data.entries[0][3] = '火貓';
  data.entries[7][3] = '火貓\\nFire Cat';
  const dictionary = new LocaleDictionary(data, { convert: value => value.replaceAll('貓', '猫') });
  assert.equal(dictionary.find('火猫', { exact: true }).rows[0].zh, '火貓');
  assert.deepEqual(dictionary.resolve('火貓').queries, ['Fire Cat']);
  assert.equal(dictionary.translate('Fire Cat').text, '火貓');
  assert.equal(dictionary.stats().scriptConversion, true);
  assert.throws(() => new LocaleDictionary(data, { convert: () => 42 }), /return a string/u);
});

test('game markup is indexed as text; original records remain intact for escaped presentation', () => {
  const data = fixture();
  data.entries.push([0, 'Tagged', '<center>Ice Shield</center>', '<center>冰盾</center>']);
  const dictionary = new LocaleDictionary(data, identity);
  const result = dictionary.find('冰盾', { exact: true });
  assert.equal(result.rows[0].zh, '<center>冰盾</center>');
  assert.deepEqual(dictionary.resolve('冰盾').queries, ['Ice Shield']);
});

test('long dialogue searches require an explicit bounded full-text option', () => {
  const dictionary = new LocaleDictionary(fixture(), identity);
  assert.equal(dictionary.find('终点提示').total, 0);
  assert.equal(dictionary.find('终点提示', { includeLongText: true }).total, 1);
  assert.equal(dictionary.stats().longTextRows, 1);
  assert.equal(dictionary.stats().fullTextRequiresOptIn, true);
});

test('dictionary validates schema, file identities, row references and string types', () => {
  assert.throws(() => new LocaleDictionary({ ...fixture(), schemaVersion: 99 }), /schemaVersion/u);
  assert.throws(() => new LocaleDictionary({ ...fixture(), entries: [[999, 'key', 'en', 'zh']] }), /file reference/u);
  assert.throws(() => new LocaleDictionary({ ...fixture(), entries: [[0, 'key', {}, 'zh']] }), /row text/u);
  assert.throws(() => new LocaleDictionary({ ...fixture(), entries: [[0, '', 'en', 'zh']] }), /row key/u);
  assert.throws(() => new LocaleDictionary({ ...fixture(), files: [{ path: '../evil.lang', table: 'evil' }] }), /file descriptor/u);
  assert.throws(() => new LocaleDictionary({ ...fixture(), files: [{ path: 'ok.lang', table: 'ok', records: 'many' }] }), /record count/u);
  const data = fixture();
  data.files.push(data.files[0]);
  assert.throws(() => new LocaleDictionary(data), /Duplicate locale file path/u);
  assert.throws(() => new LocaleDictionary({ ...fixture(), entries: Array(1000001) }), /row limit/u);
});

test('empty and oversized queries are handled without expensive unbounded searching', () => {
  const dictionary = new LocaleDictionary(fixture(), identity);
  assert.deepEqual(dictionary.find('  '), { rows: [], total: 0, exact: false });
  assert.deepEqual(dictionary.resolve(''), { queries: [], ambiguous: false, matched: false, candidates: [] });
  assert.throws(() => dictionary.find('a'.repeat(501)), /too long/u);
  assert.throws(() => dictionary.find('x', { offset: -1 }), /Invalid result bound/u);
  assert.throws(() => dictionary.resolve('x', { limit: 1000 }), /Invalid result bound/u);
});

test('static loader supports JSON/gzip and rejects corrupt and oversized content', async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'wiz-dictionary-test-'));
  t.after(() => fs.rm(temp, { force: true, recursive: true }));
  const bytes = Buffer.from(JSON.stringify(fixture()));
  for (const [name, content] of [['data.json', bytes], ['data.json.gz', zlib.gzipSync(bytes)]]) {
    const filename = path.join(temp, name);
    await fs.writeFile(filename, content);
    const dictionary = await LocaleDictionary.load(filename, identity);
    assert.equal(dictionary.stats().entries, fixture().entries.length);
    dictionary.dispose();
  }
  const corrupt = path.join(temp, 'corrupt.json.gz');
  await fs.writeFile(corrupt, Buffer.from([0x1f, 0x8b, 0]));
  await assert.rejects(LocaleDictionary.load(corrupt), /Invalid or oversized locale gzip/u);
  const invalid = path.join(temp, 'invalid.json');
  await fs.writeFile(invalid, Buffer.from([0xff, 0xfe]));
  await assert.rejects(LocaleDictionary.load(invalid), /Invalid UTF-8 locale JSON/u);
  const large = path.join(temp, 'large.json');
  const handle = await fs.open(large, 'w');
  await handle.truncate(MAX_FILE_BYTES + 1);
  await handle.close();
  await assert.rejects(LocaleDictionary.load(large), /exceeds 64 MiB/u);
  const bomb = path.join(temp, 'bomb.json.gz');
  await fs.writeFile(bomb, zlib.gzipSync(Buffer.alloc(MAX_FILE_BYTES + 1)));
  await assert.rejects(LocaleDictionary.load(bomb), /Invalid or oversized locale gzip/u);
});

test('dispose releases the data and prevents further lookups', () => {
  const dictionary = new LocaleDictionary(fixture(), identity);
  dictionary.dispose();
  assert.equal(dictionary.stats().disposed, true);
  assert.equal(dictionary._data, null);
  assert.equal(dictionary._index.size, 0);
  assert.throws(() => dictionary.find('火猫'), /disposed/u);
  dictionary.dispose();
});
