'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { LocalCatalog } = require('../lib/catalog.cjs');

const PYTHON = process.env.WIZARD101_TEST_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const IMPORTER = path.resolve(__dirname, '../tools/catalog/from-sqlite.py');
const FIXTURE = String.raw`
import sqlite3, sys
db = sqlite3.connect(sys.argv[1])
db.executescript('''
CREATE TABLE locale_en(id INTEGER PRIMARY KEY, data TEXT);
CREATE TABLE set_bonuses(id INTEGER PRIMARY KEY, name INTEGER);
CREATE TABLE items(id INTEGER PRIMARY KEY, name INTEGER, real_name TEXT, kind INTEGER, equip_school INTEGER, equip_level INTEGER, bonus_set INTEGER);
CREATE TABLE spells(id INTEGER PRIMARY KEY, template_id INTEGER, name INTEGER, real_name TEXT, school INTEGER, accuracy INTEGER, rank INTEGER, description INTEGER, form INTEGER, pve INTEGER, pvp INTEGER);
CREATE TABLE mobs(id INTEGER PRIMARY KEY, name INTEGER, real_name TEXT, primary_school INTEGER, title TEXT, hp INTEGER, rank INTEGER, has_cheats INTEGER);
CREATE TABLE pets(id INTEGER PRIMARY KEY, name INTEGER, real_name TEXT, school INTEGER, wow_factor INTEGER, exclusive INTEGER, egg_name INTEGER, strength INTEGER, intellect INTEGER, agility INTEGER, will INTEGER, power INTEGER, bonus_set INTEGER);
CREATE TABLE fish(id INTEGER PRIMARY KEY, name INTEGER, real_name TEXT, school INTEGER, rank INTEGER, base_length REAL, min_size REAL, max_size REAL, speed REAL, bite_seconds REAL, initial_bite_chance REAL, incremental_bite_chance REAL, is_sentinel INTEGER);
CREATE TABLE statcaps(level INTEGER, school INTEGER, hp INTEGER, ppc INTEGER, f_damage INTEGER, f_resist INTEGER, f_crit INTEGER);
CREATE TABLE talents(id INTEGER PRIMARY KEY, priority INTEGER, pet INTEGER, talent INTEGER);
CREATE TABLE pet_cards(id INTEGER PRIMARY KEY, pet INTEGER, spell INTEGER);
CREATE TABLE item_stats(id INTEGER PRIMARY KEY, item INTEGER, kind INTEGER, a INTEGER, b REAL);
CREATE TABLE mob_stats(id INTEGER PRIMARY KEY, mob INTEGER, kind INTEGER, a INTEGER, b REAL);
CREATE TABLE mob_items(id INTEGER PRIMARY KEY, mob INTEGER, item INTEGER);
CREATE TABLE deck(id INTEGER PRIMARY KEY, name TEXT, spell TEXT, count INTEGER);
''')
db.executemany('INSERT INTO locale_en VALUES (?, ?)', [(1,'Synthetic Deck'),(2,'Synthetic Spell'),(3,'Synthetic Boss'),(4,'Synthetic Pet'),(5,'Synthetic Fish'),(6,'Synthetic Egg'),(7,'Synthetic Talent'),(8,'Synthetic Set'),(9,'Deal {0} damage')])
db.execute('INSERT INTO set_bonuses VALUES (?, ?)', (42,8))
db.execute('INSERT INTO items VALUES (?, ?, ?, ?, ?, ?, ?)', (9007199254740993,1,b'Deck_Test',128,2147483650,100,42))
db.execute('INSERT INTO spells VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', (7,4611686020152371460,2,b'Spell_Test',2,75,4,9,2,0,0))
db.execute('INSERT INTO mobs VALUES (?, ?, ?, ?, ?, ?, ?, ?)', (9007199254740995,3,b'Boss_Test',2,'Boss',8000,10,1))
db.execute('INSERT INTO pets VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', (9007199254740997,4,b'Pet_Test',2,10,1,6,250,240,230,220,210,42))
db.execute('INSERT INTO fish VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', (9007199254740999,5,b'Fish_Test',3,2,10.0,0.8,1.2,2.0,5.0,0.3,0.1,1))
db.execute('INSERT INTO statcaps VALUES (?, ?, ?, ?, ?, ?, ?)', (170,2,8000,100,200,50,700))
db.execute('INSERT INTO talents VALUES (?, ?, ?, ?)', (9007199254741001,400,9007199254740997,7))
db.execute('INSERT INTO pet_cards VALUES (?, ?, ?)', (1,9007199254740997,b'Spell_Test'))
db.execute('INSERT INTO item_stats VALUES (?, ?, ?, ?, ?)', (1,9007199254740993,1,4611686020152371461,25))
db.execute('INSERT INTO mob_stats VALUES (?, ?, ?, ?, ?)', (1,9007199254740995,1,4611686020152371462,50))
known_stats = [
    (4927049617827923818,25), # CanonicalFireDamage
    (4927049617827923818,5),  # A second additive record at the same path
    (8270991097218515519,10), # CanonicalAllReduceDamage
    (1853945345244447112,420), # CanonicalFireCriticalHit
    (5503780012086736826,23), # CanonicalFireAccuracyRating: raw exported rating
    (7856887239808991597,350), # CanonicalMaxHealth
    (2669355392519095199,80), # CanonicalMaxMana
    (1442133179647054380,5), # CanonicalMaxEnergy
    (6363946171904787641,12), # CanonicalPowerPip
    (8613945154050726733,6), # CanonicalIncHealing
    (3048880215231770449,7), # CanonicalLifeHealing
    (9008314395548218089,30), # CanonicalShadowPipRating
    (8238137646312774092,40), # CanonicalAllArchmastery
    (5311808592473234324,8), # CanonicalIceArmorPiercing
    (6605029530240813612,50), # CanonicalLifeFlatDamage
    (8048142704309762636,15), # CanonicalDeathFlatReduceDamage
    (7616372928570938185,160), # CanonicalStormBlock
    (7684239359783256384,200), # CanonicalBalancePipConversion
    (8927214466468965361,20), # CanonicalShadowReduceDamage
    (1917893698577262159,300), # CanonicalAllPowerPipRating
]
db.executemany('INSERT INTO item_stats VALUES (?, ?, ?, ?, ?)', [(index+2,9007199254740993,1,category,value) for index,(category,value) in enumerate(known_stats)])
db.executemany('INSERT INTO item_stats VALUES (?, ?, ?, ?, ?)', [
    (101,9007199254740993,2,1,2),
    (102,9007199254740993,3,4611686020152371460,2),
    (103,9007199254740993,4,4611686020152371460,9),
    (104,9007199254740993,5,1.15,0),
    (105,9007199254740993,6,2,0),
])
db.execute('INSERT INTO mob_stats VALUES (?, ?, ?, ?, ?)', (2,9007199254740995,1,8270991097218515519,30))
db.execute('INSERT INTO mob_items VALUES (?, ?, ?)', (1,9007199254740995,9007199254740993))
db.commit()
db.close()
`;

function python(code, args = []) {
  const result = spawnSync(PYTHON, ['-B', '-c', code, ...args], { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 });
  assert.equal(result.error, undefined, `Python 3 is required for the SQLite importer tests: ${result.error?.message}`);
  assert.equal(result.status, 0, result.stderr);
  return result;
}

function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard101-catalog-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const input = path.join(dir, 'items&mode=rw.db');
  const output = path.join(dir, 'catalog.json.gz');
  python(FIXTURE, [input]);
  return { dir, input, output };
}

function run(input, output, extra = []) {
  return spawnSync(PYTHON, ['-B', IMPORTER, '--input', input, '--output', output, ...extra], { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 });
}

function read(output) {
  const buffer = fs.readFileSync(output);
  return JSON.parse((output.endsWith('.gz') ? zlib.gunzipSync(buffer) : buffer).toString('utf8'));
}

test('SQLite importer joins local records while preserving template IDs and unknown fields honestly', async t => {
  const { input, output } = setup(t);
  const result = run(input, output, ['--version', 'synthetic-test']);
  assert.equal(result.status, 0, result.stderr);
  const data = read(output);
  assert.equal(data.kind, 'wizard101.catalog');
  assert.equal(data.schemaVersion, 1);
  assert.equal(data.source.version, 'synthetic-test');
  assert.equal(data.entries.length, 6);
  const byType = Object.fromEntries(data.entries.map(entry => [entry.type, entry]));
  assert.equal(byType.item.id, '9007199254740993');
  assert.equal(byType.item.kind, 'deck');
  assert.equal(byType.item.school, 'unknown');
  assert.equal(byType.item.school_raw, 2147483650);
  assert.equal(byType.item.unparsed_stats, 1);
  assert.equal(byType.item.set_bonus.name, 'Synthetic Set');
  assert.equal(byType.spell.id, '4611686020152371460');
  assert.equal(byType.spell.row_id, '7');
  assert.equal(byType.spell.kind, 'damage');
  assert.equal(byType.spell.description, 'Deal {0} damage');
  assert.equal(byType.pet.egg, 'Synthetic Egg');
  assert.equal(byType.pet.cards[0].id, '4611686020152371460');
  assert.equal(byType.pet.cards[0].object_name, 'Spell_Test');
  assert.equal(byType.pet.talents[0].id, '9007199254741001');
  assert.equal(byType.pet.talents[0].name, 'Synthetic Talent');
  assert.equal(byType.pet.stats.strength, 250);
  assert.equal(byType.fish.min_size, 0.8);
  assert.equal(byType.fish.units.min_size, 'base_length multiplier');
  assert.equal(byType.statcaps.id, '9000200170');
  assert.equal(byType.statcaps.local_only, true);
  assert.deepEqual(byType.statcaps.stats.fire.damage, { value: 200, unit: 'percent' });
  assert.deepEqual(byType.statcaps.stats.fire.critical, { value: 700, unit: 'rating' });
  const catalog = await LocalCatalog.load(output);
  assert.equal(catalog.get('spell', '4611686020152371460').name, 'Synthetic Spell');
  assert.equal(catalog.search('pet', [], { school: 'fire', wow: 10, exclusive: true }).total, 1);
  catalog.dispose();
});

test('SQLite importer opens URI-escaped input read-only and never changes the source database', t => {
  const { input, output } = setup(t);
  const before = crypto.createHash('sha256').update(fs.readFileSync(input)).digest('hex');
  python(String.raw`
import importlib.util, sqlite3, sys
spec=importlib.util.spec_from_file_location('catalog_import',sys.argv[1])
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
connection=module.open_db(sys.argv[2])
try:
    connection.execute('DELETE FROM locale_en')
    raise AssertionError('Connection unexpectedly allowed writes')
except sqlite3.OperationalError as error:
    assert 'readonly' in str(error).lower(), str(error)
finally:
    connection.close()
`, [IMPORTER, input]);
  assert.equal(run(input, output).status, 0);
  const after = crypto.createHash('sha256').update(fs.readFileSync(input)).digest('hex');
  assert.equal(before, after);
  assert.equal(run(input, input).status, 2);
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(input)).digest('hex'), before);
});

test('SQLite importer decodes known Canonical stats as exported integers with explicit units', t => {
  const { input, output } = setup(t);
  const result = run(input, output, ['--types', 'item,mob']);
  assert.equal(result.status, 0, result.stderr);
  const data = read(output), item = data.entries.find(entry => entry.type === 'item');
  assert.equal(item.stats.fire.damage_percent, 30);
  assert.equal(item.stat_record_counts['fire.damage_percent'], 2);
  assert.match(item.notes.join('\n'), /原始加成求和/);
  assert.equal(item.stats.universal.resist_percent, 10);
  assert.equal(item.stats.fire.critical_rating, 420);
  assert.equal(item.stats.fire.accuracy_rating, 23);
  assert.equal(item.stat_units['fire.accuracy_rating'], 'exported_rating');
  assert.equal(item.stats.fire.accuracy_percent, undefined);
  assert.equal(item.stats.health, 350);
  assert.equal(item.stats.mana, 80);
  assert.equal(item.stats.energy, 5);
  assert.equal(item.stats.power_pip_percent, 12);
  assert.equal(item.stats.incoming_percent, 6);
  assert.equal(item.stats.outgoing_percent, 7);
  assert.equal(item.stats.shadow_rating, 30);
  assert.equal(item.stats.archmastery_rating, 40);
  assert.equal(item.stats.ice.pierce_percent, 8);
  assert.equal(item.stats.life.flat_damage, 50);
  assert.equal(item.stats.death.flat_resist, 15);
  assert.equal(item.stats.storm.block_rating, 160);
  assert.equal(item.stats.balance.pip_conversion, 200);
  assert.equal(item.stat_units['balance.pip_conversion'], 'rating');
  assert.equal(item.stats.shadow.resist_percent, 20);
  assert.equal(item.stats.power_pip_rating, 300);
  assert.equal(item.stats.pips, 1);
  assert.equal(item.stats.power_pips, 2);
  assert.equal(item.speed_multiplier, 1.15);
  assert.equal(item.passengers, 2);
  assert.equal(item.unparsed_stats, 1);
  assert.equal(item.parsed_stats, 25);
  const mob = data.entries.find(entry => entry.type === 'mob');
  assert.equal(mob.stats_scope, 'base_only');
  assert.equal(mob.stats.universal.resist_percent, 30);
  assert.equal(mob.unparsed_stats, 1);
  assert.match(mob.notes.join('\n'), /未把装备属性汇总/);
});

test('SQLite importer resolves item cards and Maycasts without exporting all spell entries', t => {
  const { input, output } = setup(t);
  const result = run(input, output, ['--types', 'item']);
  assert.equal(result.status, 0, result.stderr);
  const data = read(output), item = data.entries[0];
  assert.equal(data.entries.length, 1);
  assert.equal(item.cards[0].id, '4611686020152371460');
  assert.equal(item.cards[0].count, 2);
  assert.equal(item.cards[0].name, 'Synthetic Spell');
  assert.equal(item.maycasts[0].id, '4611686020152371460');
  assert.equal(item.maycasts[0].description_id, '9');
  assert.equal(item.maycasts[0].description, 'Deal {0} damage');
});

test('SQLite importer preserves large Maycast description IDs and does not guess duplicate speed semantics', t => {
  const { input, output } = setup(t);
  // The legacy test fixture declares b REAL; use a standard INTEGER b here so
  // that a genuine large reference remains exact, as in the public wizdb DDL.
  python(String.raw`
import sqlite3,sys
db=sqlite3.connect(sys.argv[1])
db.execute('DROP TABLE item_stats')
db.execute('CREATE TABLE item_stats(id INTEGER PRIMARY KEY,item INTEGER,kind INTEGER,a INTEGER,b INTEGER)')
db.execute('INSERT INTO locale_en VALUES (?, ?)',(9007199254741011,'Large reference description'))
db.executemany('INSERT INTO item_stats VALUES (?,?,?,?,?)',[
(1,9007199254740993,4,4611686020152371460,9007199254741011),
(2,9007199254740993,5,1.1,0),(3,9007199254740993,5,1.2,0),
(4,9007199254740993,6,2,0),(5,9007199254740993,6,3,0)])
db.commit()
db.close()
`, [input]);
  const result = run(input, output, ['--types', 'item']);
  assert.equal(result.status, 0, result.stderr);
  const item = read(output).entries[0];
  assert.equal(item.maycasts[0].description_id, '9007199254741011');
  assert.equal(item.maycasts[0].description, 'Large reference description');
  assert.deepEqual(item.speed_multipliers, [1.1, 1.2]);
  assert.equal(item.speed_multiplier, undefined);
  assert.deepEqual(item.passenger_counts, [2, 3]);
  assert.equal(item.passengers, undefined);
});

test('SQLite importer handles empty tables and does not invent a game version', t => {
  const { input, output } = setup(t);
  python(String.raw`
import sqlite3,sys
db=sqlite3.connect(sys.argv[1])
for (table,) in db.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall():
    db.execute('DELETE FROM "'+table+'"')
db.commit()
db.close()
`, [input]);
  const result = run(input, output);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(read(output).entries, []);
  assert.equal(read(output).source.version, '未标注');
});

test('SQLite importer reports missing schema columns and does not publish a partial catalogue', t => {
  const { dir } = setup(t);
  const input = path.join(dir, 'bad.db'), output = path.join(dir, 'bad.json');
  python(String.raw`
import sqlite3,sys
db=sqlite3.connect(sys.argv[1])
db.executescript('CREATE TABLE locale_en(id INTEGER,data TEXT); CREATE TABLE spells(id INTEGER,name INTEGER,real_name TEXT);')
db.close()
`, [input]);
  const result = run(input, output);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /spells.*template_id/);
  assert.equal(fs.existsSync(output), false);
  const missing = path.join(dir, 'not-present.db');
  assert.equal(run(missing, output).status, 2);
  assert.equal(fs.existsSync(missing), false);
});

test('SQLite importer associates optional decks by internal names without duplicating preferred sources', t => {
  const { dir, input, output } = setup(t);
  const decks = path.join(dir, 'decks.db');
  python(String.raw`
import sqlite3,sys
db=sqlite3.connect(sys.argv[1])
db.execute('CREATE TABLE deck(id INTEGER PRIMARY KEY,name TEXT,spell TEXT,count INTEGER)')
db.executemany('INSERT INTO deck VALUES (?,?,?,?)',[(1,b'Boss_Test',b'Spell_Test',3),(2,b'Deck_Test',b'Spell_Test',1)])
db.commit()
db.close()
source=sqlite3.connect(sys.argv[2])
source.execute('INSERT INTO deck VALUES (?,?,?,?)',(1,b'Boss_Test',b'Spell_Test',2))
source.commit()
source.close()
`, [decks, input]);
  const result = run(input, output, ['--decks', decks]);
  assert.equal(result.status, 0, result.stderr);
  const mob = read(output).entries.find(entry => entry.type === 'mob');
  assert.deepEqual(mob.deck.map(entry => entry.count), [2, 1]);
  assert.equal(mob.deck[0].id, '4611686020152371460');
});

test('SQLite importer supports focused type exports while still resolving pet card references', t => {
  const { input, output } = setup(t);
  const result = run(input, output, ['--types', 'pet,fish,statcaps']);
  assert.equal(result.status, 0, result.stderr);
  const data = read(output);
  assert.deepEqual(data.entries.map(entry => entry.type), ['pet', 'fish', 'statcaps']);
  assert.equal(data.entries[0].cards[0].name, 'Synthetic Spell');
});

test('SQLite importer rejects oversized relations, duplicate template IDs, and nonfinite data', t => {
  const { input, output } = setup(t);
  python(String.raw`
import sqlite3,sys
db=sqlite3.connect(sys.argv[1])
db.execute('DELETE FROM talents')
db.executemany('INSERT INTO talents VALUES (?,?,?,?)',[(i,i,9007199254740997,7) for i in range(513)])
db.commit()
db.close()
`, [input]);
  assert.match(run(input, output).stderr, /talents 超过 512/);
  assert.equal(fs.existsSync(output), false);
  python(String.raw`
import sqlite3,sys
db=sqlite3.connect(sys.argv[1])
db.execute('DELETE FROM talents')
db.execute('INSERT INTO spells(id,template_id,name,real_name) VALUES (?,?,?,?)',(8,4611686020152371460,2,b'OtherSpell'))
db.commit()
db.close()
`, [input]);
  assert.match(run(input, output).stderr, /重复类型与 ID/);
  python(String.raw`
import sqlite3,sys
db=sqlite3.connect(sys.argv[1])
db.execute('DELETE FROM spells WHERE id=8')
db.execute('UPDATE fish SET speed=?',(float('inf'),))
db.commit()
db.close()
`, [input]);
  assert.match(run(input, output).stderr, /无效.*浮点数/);
  assert.equal(fs.existsSync(output), false);
});
