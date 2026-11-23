'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const PYTHON = process.env.WIZARD101_TEST_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const FIXTURE = path.resolve(__dirname, 'spell-effects-fixture.py');

function run(mode) {
  const result = spawnSync(PYTHON, ['-B', FIXTURE, mode], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, timeout: 30000 });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('spell interpreter exercises all 152 upstream enums and 15,948 branch combinations', () => {
  const data = run('sweep');
  assert.equal(data.enum, 152);
  assert.equal(data.supported, 119);
  assert.equal(data.unsupported, 33);
  assert.equal(data.labels, 152);
  assert.equal(data.cases, 15948);
  assert.equal(Object.keys(data.examples).length, 152);
  assert.match(data.examples.bounce_next, /未解释效果.*bounce_next.*原字段已保留/u);
});

test('damage, shields, blades, auras, protected effects, drain and percentages keep their distinct units', () => {
  const data = run('core');
  assert.equal(data.damage, '125 【火焰】【伤害】 【单个敌人】');
  assert.match(data.protected_dot, /300.*受保护持续伤害.*3【回合】/u);
  assert.equal(data.heal_percent, '25% 【火焰】【治疗】 【单个敌人】');
  assert.match(data.max_health, /15% 最大生命值/u);
  assert.doesNotMatch(data.max_health, /3【回合】/u);
  assert.match(data.absorb, /500.*受保护吸收盾/u);
  assert.match(data.blade, /\+35%.*【刃】/u);
  assert.match(data.weakness, /-25%.*【虚弱】/u);
  assert.match(data.trap, /\+30%.*【陷阱】/u);
  assert.match(data.shield, /-50%.*【盾】/u);
  assert.match(data.negative_aura, /负面光环.*4【回合】/u);
  assert.match(data.global, /【全场结界】/u);
  assert.doesNotMatch(data.global, /【陷阱】|【负面光环】/u);
  assert.match(data.steal, /600.*吸血.*50\.0%/u);
  assert.match(data.detonate[0], /引爆 150% 全部.*持续伤害.*持续治疗/u);
  assert.match(data.detonate[1], /立即结算 150% 全部.*持续治疗/u);
  assert.doesNotMatch(data.detonate[1], /持续伤害/u);
  assert.match(data.detonate[2], /引爆.*持续伤害/u);
  assert.match(data.swap[0], /正面咒符.*负面咒符/u);
  assert.doesNotMatch(data.swap[1], /负面咒符/u);
  assert.doesNotMatch(data.swap[2], /正面咒符/u);
});

test('all 21 effect target codes retain explicit targeting semantics', () => {
  const data = run('targets');
  assert.equal(Object.keys(data).length, 21);
  for (const [code, expected] of Object.entries({ 0: '目标未指定', 1: '附魔卡', 2: '附魔卡', 3: '全场结界', 4: '全体敌人', 5: '全体敌人', 6: '全体队友', 7: '全体队友', 8: '单个敌人', 9: '单个队友', 10: '随从', 11: '自身', 12: '预选单个敌人', 13: '至少一个敌人', 14: '选定多个敌人', 15: '选定多个队友', 16: '其他单个队友' })) {
    assert.ok(data[code].includes(expected), `${code}: ${data[code]}`);
  }
  for (const code of [17, 18, 19, 20]) assert.match(data[code], /随从/u);
});

test('X-pip branches, conversion ratios, prism hashes and school pips are translated', () => {
  const data = run('pips');
  assert.match(data.x, /^3 【魔豆】: 80/u);
  assert.match(data.convert_zero, /^1: 25% 原效果转化为/u);
  assert.match(data.convert_rank, /^2: \+25%/u);
  assert.equal(data.school.length, 7);
  assert.match(data.school[0], /火焰魔豆/u);
  assert.match(data.school[6], /平衡魔豆/u);
  assert.match(data.prism, /【火焰】 转为 【冰霜】.*负面护符/u);
  assert.match(data.percent_rank, /\+30 每 【魔豆】 \(上限: 300\)/u);
});

test('spell and creature references resolve by ID without exposing Python row reprs', () => {
  const data = run('references');
  assert.match(data.add_spell_to_deck, /引用法术.*加入牌库/u);
  assert.match(data.add_spell_to_hand, /引用法术.*加入手牌/u);
  assert.match(data.modify_card_mutation, /变异为 引用法术/u);
  for (const name of ['kill_creature', 'spawn_creature', 'summon_creature']) assert.match(data[name], /引用生物/u);
  assert.doesNotMatch(JSON.stringify(data), /None|\[\(|b'/u);
});

test('all eight effect classes preserve nesting, random, condition, variable and convert branches', () => {
  const data = run('hierarchy');
  assert.equal(data.classes.length, 8);
  assert.deepEqual(data.warnings, []);
  assert.match(data.text, /随机分支/u);
  assert.match(data.text, /按魔豆数量变化/u);
  assert.match(data.text, /3 【魔豆】: 12/u);
  assert.match(data.text, /若 目标 【火焰】/u);
  assert.match(data.text, /转换 2 【刃】/u);
  assert.match(data.text, /1: 16% 原效果转化为/u);
  assert.match(data.text, /暗影契约/u);
  assert.ok(data.text.split('\n').some(line => line.startsWith('  ')), data.text);
});

test('conditions translate balance exclusions, weaving, boolean predicates and effect names', () => {
  const data = run('conditions');
  assert.equal(data.balance_target, '若 【平衡】');
  assert.equal(data.balance_caster, '若 【自身】【平衡】');
  assert.match(data.weaving, /施法者编织学派.*火焰.*目标编织学派.*冰霜/u);
  assert.match(data.logic, /调整造成的伤害.*且.*不满足.*低于 20% 生命值.*或/u);
  assert.doesNotMatch(data.logic, /Target|Caster|Modify|Incoming|Outgoing|below|Pips/u);
  assert.match(data.convert, /【刃】.*【陷阱】.*持续伤害/u);
});

test('chromatic condensation requires six different schools and keeps caster versus target distinct', () => {
  const data = run('chromatic');
  assert.match(data.target, /元素系.*精神系.*随目标学派变化/su);
  assert.match(data.caster, /自身.*元素系.*精神系.*随施法者学派变化/su);
  assert.equal((data.repeated.match(/If Target/gu) || []).length, 6);
  assert.equal(data.duplicates, '一行 x3\n\n另一行');
});

test('all legacy description variables and icon tokens expand with safe missing-index handling', () => {
  const data = run('templates');
  assert.match(data.parsed, /^125\|\|250\|250\|50\|4\|\|4\|【冰霜】\|→\|【伤害】\|\$UnknownToken\$\|%\|$/u);
  assert.doesNotMatch(data.parsed, /<center>|discard|eAExtra/u);
  assert.equal(data.overflow, '$eAMax3$ $eARounds3$ 250');
  assert.equal(data.empty, '$eA$ $eAMax$ $eARounds$ $dT_image$');
  assert.ok(Object.keys(data.icons).length >= 80);
  for (const [name, rendered] of Object.entries(data.icons)) assert.doesNotMatch(rendered, /\$/u, name);
  assert.ok(data.warnings.some(warning => warning.includes('$UnknownToken$')));
  assert.ok(data.warnings.some(warning => warning.includes('eAMul')));
});

test('SQLite joins use template IDs and export common, default and observed target-count variants', () => {
  const data = run('variants');
  assert.deepEqual(data.effect_variants.map(variant => variant.num_targets), [0, 1, 2, 3, 4, 7]);
  const variants = Object.fromEntries(data.effect_variants.map(variant => [variant.num_targets, variant]));
  assert.equal(variants[0].effect_count, 1);
  assert.equal(variants[1].effect_count, 2);
  assert.equal(variants[7].effect_count, 2);
  assert.match(variants[0].text, /100/u);
  assert.doesNotMatch(variants[0].text, /200|700|999/u);
  assert.match(variants[1].text, /200/u);
  assert.match(variants[7].text, /700/u);
  assert.deepEqual(data.explicit.map(variant => variant.num_targets), [0, 99]);
  assert.equal(data.explicit[1].text, variants[0].text);
  assert.equal(data.effect_rows.length, 3);
  assert.equal(data.effect_rows[0][1], '9007199254740993');
  assert.equal(data.effect_fields.length, 17);
  assert.equal(data.description_parsed, 'Deal 125 【火焰】 【伤害】.');
  assert.equal(data.description_zh, '造成 125 【火焰】 【伤害】。');
  assert.ok(data.calls.some(call => call[1] === 'locale_en:2'));
});

test('unknown effects, targets, schools and prism hashes retain their complete original fields', () => {
  const data = run('unknown');
  assert.equal(data.effect_unparsed.length, 5);
  assert.equal(data.effect_fields.length, 17);
  assert.equal(data.effect_rows, undefined);
  assert.ok(data.effect_unparsed.every(row => row.raw.length === 17));
  const unknown = data.effect_unparsed.find(row => row.type === 999);
  assert.equal(unknown.raw[5], 12345);
  assert.equal(unknown.raw[1], '9007199254740993');
  assert.match(data.effect_variants[0].text, /未解释效果.*unknown_999/u);
  assert.match(data.effect_variants[0].text, /未知转换学派 1234/u);
  assert.match(data.description_zh, /^原文（未提供中文本地化）/u);
});

test('missing object references and unknown condition prose remain explicit with original records', () => {
  const data = run('unknown_references');
  assert.equal(data.effect_unparsed.length, 2);
  assert.match(data.effect_variants[0].text, /未解析法术 ID=555555/u);
  assert.match(data.effect_variants[0].text, /部分条件保留原文.*UnmappedStatus/u);
  const condition = data.effect_unparsed.find(row => row.id === 2);
  assert.equal(condition.raw[16], 'If Target UnmappedStatus');
});

test('orphan and cyclic effect nodes produce diagnostics instead of disappearing or recursing forever', () => {
  const data = run('cycles');
  assert.match(data.text, /独立或异常节点/u);
  assert.ok(data.warnings.some(warning => /循环/u.test(warning)));
  assert.ok(data.unknown.length >= 3);
  assert.ok(data.text.length < 10000);
});

test('missing optional effect tables preserve the source description and report unavailable expansion', () => {
  const data = run('missing');
  assert.equal(data.spell_effects_available, false);
  assert.equal(data.description_raw, 'Deal $eA$ $dT_image$ $Damage_image$.');
  assert.match(data.description_parsed, /\$eA\$/u);
  assert.ok(data.effect_variants.every(variant => variant.effect_count === 0 && variant.text === ''));
  assert.ok(data.effect_warnings.some(warning => warning.includes('缺少 effects')));
  assert.ok(data.effect_warnings.some(warning => warning.includes('缺少 spell_effects')));
});

test('row, text, variant, duplicate-ID and transparent-recursion budgets fail explicitly without truncation', () => {
  const data = run('bounds');
  assert.equal(Object.keys(data).length, 8);
  assert.match(data.row_limit, /上限/u);
  assert.match(data.depth, /层级上限/u);
  assert.match(data.transparent_depth, /层级上限/u);
  assert.match(data.duplicate, /重复/u);
  assert.match(data.variants, /128/u);
  assert.match(data.text, /长度上限/u);
  assert.match(data.unknown_id, /模板 ID=7/u);
  assert.match(data.wrong_row, /template_id/u);
});

test('spell rendering issues no writes against an authorizer-protected SQLite connection', () => {
  const data = run('readonly');
  assert.equal(data.after, data.before);
  assert.equal(data.result.description_parsed, 'Deal 125 【火焰】 【伤害】.');
});

test('bounded preload avoids repeated unindexed effect-table scans while preserving every variant', () => {
  const data = run('preload');
  assert.equal(data.equal, true);
  assert.equal(data.stats.rows, 5);
  assert.equal(data.stats.effect_spells, 1);
  assert.ok(data.queries.every(query => !/\bFROM (?:effects|spell_effects)\b/u.test(query)), data.queries.join('\n'));
  assert.match(data.budget, /预算/u);
  assert.equal(data.cache_intact, true);
});
