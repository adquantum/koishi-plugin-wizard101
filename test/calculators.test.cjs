'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateDamage, formatDamageReport, CalculationError } = require('../lib/calculators.cjs');

test('single-hit calculator defaults to the base damage and explains its scope', () => {
  const result = calculateDamage({ base: 500 });
  assert.equal(result.normal, 500);
  assert.equal(result.critical, 500);
  assert.equal(result.stages[0].value, 500);
  const report = formatDamageReport(result);
  assert.match(report, /普通伤害：500/);
  assert.match(report, /不是原始 rating/);
  assert.match(report, /不复刻服务器逐阶段舍入/);
  assert.match(report, /DoT/);
});

test('single-hit calculator exposes a hand-derived sequence with flats and buffs', () => {
  // 400 × 2 + 20 = 820; × 1.5 = 1230; × .8 = 984; × 1.25 = 1230;
  // × .75 = 922.5; × .8 = 738; − 38 = 700; × 1.5 = 1050.
  const result = calculateDamage({
    base: 400, damagePercent: 100, flatDamage: 20, blades: [50],
    weaknesses: [20], traps: [25], shields: [25], resistPercent: 20,
    flatResist: 38, criticalMultiplier: 1.5,
  });
  assert.equal(result.normal, 700);
  assert.equal(result.critical, 1050);
  assert.equal(result.stages.find(row => row.label.startsWith('刃 1')).value, 1230);
  assert.equal(result.stages.find(row => row.label.startsWith('盾 1')).value, 922.5);
});

test('single-hit calculator does not merge equal percentages from different sources', () => {
  const result = calculateDamage({ base: 1000, blades: [40, 40], traps: [30, 30] });
  // 1000 × 1.4² × 1.3² = 3312.4.
  assert.equal(result.normal, 3312);
  assert.equal(result.stages.filter(row => row.label.startsWith('刃 ')).length, 2);
  assert.match(result.assumptions.join('\n'), /不判断同源叠加合法性/);
});

test('single-hit calculator consumes pierce on shields in their supplied order', () => {
  // 60 pierce removes 50 from shield 1 and 10 from shield 2; 20 shield remains.
  const result = calculateDamage({ base: 1000, shields: [50, 30], resistPercent: 20, piercePercent: 60 });
  assert.equal(result.normal, 640);
  assert.match(result.stages.find(row => row.label.startsWith('盾 1')).label, /余穿透 10%/);
  assert.match(result.stages.find(row => row.label.startsWith('盾 2')).label, /生效 20%，余穿透 0%/);
  const reordered = calculateDamage({ base: 1000, shields: [50, 30], piercePercent: 20 });
  assert.equal(reordered.normal, 490);
});

test('single-hit calculator applies remaining pierce to resistance without creating vulnerability', () => {
  // Shield consumes 50, leaving 10 pierce for 20 resist: 1000 × .9 = 900.
  assert.equal(calculateDamage({ base: 1000, shields: [50], resistPercent: 20, piercePercent: 60 }).normal, 900);
  assert.equal(calculateDamage({ base: 1000, shields: [50], resistPercent: 20, piercePercent: 200 }).normal, 1000);
  // Decimal pierce is consumed exactly: 0.3 - 0.1 - 0.2 = 0.
  assert.equal(calculateDamage({ base: 1000, shields: [0.1], resistPercent: 0.2, piercePercent: 0.3 }).normal, 1000);
});

test('single-hit calculator preserves negative resistance even with unused pierce', () => {
  const result = calculateDamage({ base: 1000, resistPercent: -50, piercePercent: 100 });
  assert.equal(result.normal, 1500);
  assert.match(result.stages.find(row => row.label.startsWith('负抗性')).label, /余穿透 100% 不增伤/);
});

test('single-hit calculator never lets pierce remove weaknesses or flat resistance', () => {
  const result = calculateDamage({ base: 1000, weaknesses: [25], flatResist: 50, piercePercent: 1000 });
  assert.equal(result.normal, 700);
});

test('single-hit calculator clamps immunity and flat resistance at zero', () => {
  assert.equal(calculateDamage({ base: 1000, resistPercent: 120 }).normal, 0);
  assert.equal(calculateDamage({ base: 1000, resistPercent: 120, piercePercent: 50 }).normal, 300);
  assert.equal(calculateDamage({ base: 100, flatResist: 1000, criticalMultiplier: 10 }).critical, 0);
  assert.equal(calculateDamage({ base: 1000, weaknesses: [100] }).normal, 0);
  assert.equal(calculateDamage({ base: 0 }).normal, 0);
});

test('single-hit calculator floors only the final values and applies critical before flooring', () => {
  const result = calculateDamage({ base: 101, damagePercent: 50, criticalMultiplier: 1.5 });
  assert.equal(result.normal, 151);
  assert.equal(result.critical, 227); // 151.5 × 1.5 = 227.25, not 151 × 1.5.
  assert.equal(result.stages.find(row => row.label.startsWith('面板')).value, 151.5);
});

test('single-hit calculator rejects nonfinite and implicitly coerced inputs', () => {
  for (const base of [NaN, Infinity, -Infinity, '100', '', null, undefined, true, 10n]) {
    assert.throws(() => calculateDamage({ base }), error => error instanceof CalculationError && /输入错误/.test(error.message));
  }
  assert.throws(() => calculateDamage(null), /参数对象/);
  assert.throws(() => calculateDamage([]), /参数对象/);
  assert.throws(() => calculateDamage({ base: 100, expression: 'process.exit()' }), /未知/);
  assert.throws(() => calculateDamage({ base: 100, blades: [NaN] }), /刃第 1 项/);
  assert.throws(() => calculateDamage({ base: 100, shields: new Array(1) }), /盾第 1 项/);
});

test('single-hit calculator enforces explicit scalar and list bounds', () => {
  for (const input of [
    { base: -1 }, { base: 1_000_000_001 }, { base: 1, damagePercent: -1 },
    { base: 1, damagePercent: 1001 }, { base: 1, flatDamage: -1 },
    { base: 1, flatResist: -1 }, { base: 1, resistPercent: -101 },
    { base: 1, resistPercent: 1001 }, { base: 1, piercePercent: -1 },
    { base: 1, piercePercent: 1001 }, { base: 1, criticalMultiplier: 0.5 },
    { base: 1, criticalMultiplier: 10.1 }, { base: 1, shields: [101] },
    { base: 1, weaknesses: [-5] }, { base: 1, blades: [1001] },
    { base: 1, traps: '30 40' }, { base: 1, blades: Array(17).fill(0) },
    { base: 0.0000001 },
  ]) assert.throws(() => calculateDamage(input), CalculationError);
  assert.equal(calculateDamage({ base: 1_000_000_000 }).normal, 1_000_000_000);
  assert.equal(calculateDamage({ base: 1, resistPercent: -100 }).normal, 2);
  assert.equal(calculateDamage({ base: 1, blades: Array(16).fill(0) }).normal, 1);
});

test('single-hit calculator rejects accumulated unsafe magnitudes without mutating inputs', () => {
  assert.throws(() => calculateDamage({ base: 1_000_000_000, blades: Array(16).fill(1000) }), /超过可安全表示/);
  const input = Object.freeze({ base: 1000, shields: Object.freeze([50, 30]), piercePercent: 60 });
  assert.equal(calculateDamage(input).normal, 800);
  assert.deepEqual(input.shields, [50, 30]);
  assert.equal(input.piercePercent, 60);
});

test('damage report validates result data instead of formatting invalid values', () => {
  assert.throws(() => formatDamageReport({ normal: NaN }), /结果格式无效/);
  assert.throws(() => formatDamageReport({ normal: 1, critical: 1, stages: [{ label: 'bad', value: Infinity }], assumptions: [] }), /结果格式无效/);
});
