'use strict';

// This is an explicit, simplified single-hit model. It does not attempt to
// reproduce Wizard101's server formula, rating curves, or intermediate rounding.
// No code or coefficients from another bot's implementation are used here.

const MAX_BUFFS = 16;
const MAX_FLAT = 1_000_000_000;
const MAX_PERCENT = 1_000;
const INPUT_FIELDS = new Set([
  'base', 'damagePercent', 'flatDamage', 'blades', 'weaknesses', 'traps',
  'shields', 'resistPercent', 'flatResist', 'piercePercent', 'criticalMultiplier',
]);

class CalculationError extends Error {
  constructor(message) {
    super(`输入错误：${message}`);
    this.name = 'CalculationError';
    this.code = 'invalid-calculation';
  }
}

function numberInRange(value, label, minimum, maximum) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new CalculationError(`${label}必须是有限数值，不能使用空值、字符串、NaN 或无穷大。`);
  }
  if (value < minimum || value > maximum) {
    throw new CalculationError(`${label}必须在 ${minimum} 到 ${maximum} 之间。`);
  }
  if (Number(value.toFixed(6)) !== value) {
    throw new CalculationError(`${label}最多支持 6 位小数。`);
  }
  return Object.is(value, -0) ? 0 : value;
}

function percentages(values, label, maximum) {
  if (!Array.isArray(values) || values.length > MAX_BUFFS) {
    throw new CalculationError(`${label}必须是最多 ${MAX_BUFFS} 项的数值数组。`);
  }
  return Array.from(values, (value, index) => numberInRange(value, `${label}第 ${index + 1} 项`, 0, maximum));
}

function pretty(value) {
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 6 }).format(value);
}

// Exact fractions keep decimal inputs exact until the final floor. In
// particular, 1000 * 0.7 * 0.7 must not become 489 due to binary floating point.
// Input precision and list lengths are bounded above to keep bigint work small.
function fraction(n, d = 1n) {
  let a = n < 0n ? -n : n;
  let b = d;
  while (b) [a, b] = [b, a % b];
  return { n: n / a, d: d / a };
}
function decimal(value) {
  const [whole, part = ''] = String(value).split('.');
  return fraction(BigInt(whole + part), 10n ** BigInt(part.length));
}
function add(a, b) { return fraction(a.n * b.d + b.n * a.d, a.d * b.d); }
function subtract(a, b) { return fraction(a.n * b.d - b.n * a.d, a.d * b.d); }
function multiply(a, b) { return fraction(a.n * b.n, a.d * b.d); }
function minimum(a, b) { return a.n * b.d <= b.n * a.d ? a : b; }
function approximate(a) {
  if (a.n === 0n) return 0;
  const n = a.n.toString(), d = a.d.toString();
  return Number(n.slice(0, 16)) / Number(d.slice(0, 16))
    * 10 ** (Math.max(0, n.length - 16) - Math.max(0, d.length - 16));
}
function factor(percent, decrease = false) {
  const amount = typeof percent === 'number' ? decimal(percent) : percent;
  return add({ n: 1n, d: 1n }, multiply(amount, { n: decrease ? -1n : 1n, d: 100n }));
}

/**
 * Estimate one damage hit using already-curved panel percentages.
 * Positive blades/traps increase damage; positive weaknesses/shields reduce it.
 * Each supplied buff is assumed to be an eligible, independently stacking source.
 * Pierce is consumed by shields in input order, then by nonnegative resistance.
 * Negative resistance remains a vulnerability; unused pierce never adds damage.
 */
function calculateDamage(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new CalculationError('请提供伤害参数对象。');
  }
  if (Object.keys(input).some(key => !INPUT_FIELDS.has(key))) {
    throw new CalculationError('存在未知的伤害参数，请检查参数名称。');
  }
  const {
    base, damagePercent = 0, flatDamage = 0, blades = [], weaknesses = [],
    traps = [], shields = [], resistPercent = 0, flatResist = 0,
    piercePercent = 0, criticalMultiplier = 1,
  } = input;
  const initial = numberInRange(base, '基础伤害', 0, MAX_FLAT);
  const damage = numberInRange(damagePercent, '面板伤害百分比', 0, MAX_PERCENT);
  const flat = numberInRange(flatDamage, '固定增伤', 0, MAX_FLAT);
  const bladeValues = percentages(blades, '刃', MAX_PERCENT);
  const weaknessValues = percentages(weaknesses, '虚弱', 100);
  const trapValues = percentages(traps, '陷阱', MAX_PERCENT);
  const shieldValues = percentages(shields, '盾', 100);
  const resistance = numberInRange(resistPercent, '抗性百分比', -100, MAX_PERCENT);
  const flatResistance = numberInRange(flatResist, '固定减伤', 0, MAX_FLAT);
  let pierce = decimal(numberInRange(piercePercent, '穿透百分比', 0, MAX_PERCENT));
  const criticalFactor = numberInRange(criticalMultiplier, '手动暴击倍率', 1, 10);

  let value = decimal(initial);
  const stages = [];
  function stage(label, nextValue) {
    if (nextValue.n < 0n || nextValue.n > BigInt(Number.MAX_SAFE_INTEGER) * nextValue.d) {
      throw new CalculationError('累计伤害超过可安全表示的范围，请减少基础伤害、增伤或叠加数量。');
    }
    value = nextValue;
    stages.push({ label, value: approximate(value) });
  }

  stage('基础伤害', value);
  stage(`面板伤害 +${pretty(damage)}%`, multiply(value, factor(damage)));
  stage(`固定增伤 +${pretty(flat)}`, add(value, decimal(flat)));
  bladeValues.forEach((percent, index) => {
    stage(`刃 ${index + 1}：+${pretty(percent)}%`, multiply(value, factor(percent)));
  });
  weaknessValues.forEach((percent, index) => {
    stage(`虚弱 ${index + 1}：−${pretty(percent)}%`, multiply(value, factor(percent, true)));
  });
  trapValues.forEach((percent, index) => {
    stage(`陷阱 ${index + 1}：+${pretty(percent)}%`, multiply(value, factor(percent)));
  });
  shieldValues.forEach((percent, index) => {
    const consumed = minimum(decimal(percent), pierce);
    pierce = subtract(pierce, consumed);
    const effective = subtract(decimal(percent), consumed);
    stage(`盾 ${index + 1}：${pretty(percent)}%，穿透抵消 ${pretty(approximate(consumed))}%，生效 ${pretty(approximate(effective))}%，余穿透 ${pretty(approximate(pierce))}%`, multiply(value, factor(effective, true)));
  });
  if (resistance >= 0) {
    const consumed = minimum(decimal(resistance), pierce);
    pierce = subtract(pierce, consumed);
    const effective = subtract(decimal(resistance), consumed);
    const multiplier = factor(effective, true);
    stage(`抗性：${pretty(resistance)}%，穿透抵消 ${pretty(approximate(consumed))}%，生效 ${pretty(approximate(effective))}%，余穿透 ${pretty(approximate(pierce))}%`, multiplier.n < 0n ? decimal(0) : multiply(value, multiplier));
  } else {
    stage(`负抗性：${pretty(resistance)}%，保留 ${pretty(-resistance)}% 易伤，余穿透 ${pretty(approximate(pierce))}% 不增伤`, multiply(value, factor(resistance, true)));
  }
  const afterFlat = subtract(value, decimal(flatResistance));
  stage(`固定减伤 −${pretty(flatResistance)}（最低 0）`, afterFlat.n < 0n ? decimal(0) : afterFlat);

  const unrounded = value;
  const normal = Number(unrounded.n / unrounded.d);
  stage('普通伤害：最终向下取整', decimal(normal));
  stage(`手动暴击倍率 ×${pretty(criticalFactor)}（基于取整前伤害）`, multiply(unrounded, decimal(criticalFactor)));
  const critical = Number(value.n / value.d);
  stage('暴击伤害：最终向下取整', decimal(critical));

  return {
    normal,
    critical,
    stages,
    assumptions: [
      '这是简化单段伤害估算；输入伤害/抗性百分比是已处理游戏曲线的面板值，不是原始 rating。',
      '顺序：基础伤害 → 面板百分比 → 固定增伤 → 刃 → 虚弱 → 陷阱 → 盾 → 抗性 → 固定减伤；暴击倍率应用于最后的未取整结果。',
      '穿透按输入顺序消耗于盾，再消耗于非负抗性；不能抵消虚弱或固定减伤，余量不额外增伤，负抗性保留易伤。',
      '每个刃/陷阱/盾/虚弱均视为已确认可叠加的独立来源；输入相同数值可以代表不同来源，本工具不判断同源叠加合法性。',
      '暴击倍率由用户手动输入，不从暴击/格挡 rating 推算，也不计算暴击概率或期望伤害。',
      '输入最多 6 位小数，内部按精确分数计算；步骤展示最多 6 位小数，仅普通/暴击最终结果各向下取整。不复刻服务器逐阶段舍入；DoT、多段、吸收、转换和特殊战斗规则不在本模型内。',
    ],
  };
}

function formatDamageReport(result) {
  if (!result || !Number.isSafeInteger(result.normal) || result.normal < 0
      || !Number.isSafeInteger(result.critical) || result.critical < 0
      || !Array.isArray(result.stages) || result.stages.length > 80
      || !Array.isArray(result.assumptions) || result.assumptions.length > 10
      || result.stages.some(row => !row || typeof row.label !== 'string' || row.label.length > 200 || !Number.isFinite(row.value))
      || result.assumptions.some(value => typeof value !== 'string' || value.length > 400)) {
    throw new CalculationError('伤害结果格式无效，请重新计算。');
  }
  return [
    '【单段伤害估算】',
    `普通伤害：${pretty(result.normal)}`,
    `按手动倍率暴击：${pretty(result.critical)}`,
    '',
    '计算步骤：',
    ...result.stages.map((row, index) => `${index + 1}. ${row.label} → ${pretty(row.value)}`),
    '',
    '模型假设：',
    ...result.assumptions.map(value => `• ${value}`),
  ].join('\n');
}

module.exports = { calculateDamage, formatDamageReport, CalculationError };
