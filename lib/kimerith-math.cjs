'use strict';

// SPDX-License-Identifier: GPL-3.0-only
// Derived from MajorPain1/Kimerith-WindHammer, bot/database.py and
// bot/extensions/mobs.py at 3c24847d111387fc0b34772b548f74e80089599f.
// Original project: https://github.com/MajorPain1/Kimerith-WindHammer
// The arithmetic/order below intentionally follows that revision, including
// documented compatibility quirks. It is not a claim about the live game server.

const PROVENANCE = Object.freeze({
  repository: 'https://github.com/MajorPain1/Kimerith-WindHammer',
  revision: '3c24847d111387fc0b34772b548f74e80089599f',
  mode: 'kimerith-compatible',
});
const SCHOOLS = Object.freeze(['fire', 'ice', 'storm', 'myth', 'life', 'death', 'balance', 'star', 'sun', 'moon', 'shadow']);
const INPUT_KEYS = new Set(['base', 'damage', 'pierce', 'critical', 'resist', 'block', 'buffs', 'pvp']);
const MOB_KEYS = new Set(['base', 'damage', 'pierce', 'critical', 'buffs', 'pvp', 'school', 'mobCombat']);

class KimerithInputError extends Error {
  constructor(message) {
    super(message);
    this.name = 'KimerithInputError';
    this.code = 'invalid-calculation';
  }
}

function number(value, label, { integer = false, min = -1e9, max = 1e9 } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value) || (integer && !Number.isSafeInteger(value)) || value < min || value > max) {
    throw new KimerithInputError(`${label}必须是 ${min}–${max} 范围内的${integer ? '整数' : '有限数字'}。`);
  }
  return Object.is(value, -0) ? 0 : value;
}

function truncate(value) {
  if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) throw new KimerithInputError('计算结果超过可安全表示的范围，请减少参数或 Buff 数量。');
  const result = Math.trunc(value);
  return Object.is(result, -0) ? 0 : result;
}

function validateObject(input, keys) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new KimerithInputError('请提供计算参数对象。');
  if (Object.keys(input).some(key => !keys.has(key))) throw new KimerithInputError('Kimerith 模式存在未知参数；请勿混用简化模式的 damagePercent、手动暴击倍率等参数。');
}

function buff(value, isPierce) {
  return { value, modifier: value / 100 + 1, isPierce };
}

function translateBuffs(value = '') {
  if (typeof value !== 'string' || value.length > 2048) throw new KimerithInputError('Buff 必须是最多 2048 字符的文本，例如 35 35 40 20P -50P。');
  const stripped = value.replaceAll('%', '');
  if (!stripped) return { buffs: [], ignoredTokens: [], warnings: [] };
  const tokens = stripped.split(' ');
  if (tokens.length > 128) throw new KimerithInputError('Buff 最多支持 128 个以空格分隔的项目。');
  const buffs = [], ignoredTokens = [], warnings = [];
  let empty = false;
  // Python float permits an underscore between decimal digits. Invalid tokens
  // are ignored as upstream does; nonfinite tokens are rejected deliberately.
  const digits = '[0-9](?:_?[0-9])*';
  const decimal = new RegExp(`^[+-]?(?:${digits}(?:\\.(?:${digits})?)?|\\.${digits})(?:[eE][+-]?${digits})?$`);
  for (const original of tokens) {
    if (original === '') { empty = true; continue; }
    const isPierce = original.endsWith('P');
    const token = (isPierce ? original.slice(0, -1) : original).trim();
    if (/^[+-]?(?:nan|inf(?:inity)?)$/i.test(token)) throw new KimerithInputError('Buff 不接受 NaN 或无穷大。');
    if (!decimal.test(token)) { ignoredTokens.push(original.slice(0, 80)); continue; }
    buffs.push(buff(number(Number(token.replaceAll('_', '')), 'Buff 数值', { min: -10000, max: 10000 }), isPierce));
  }
  if (empty) warnings.push('已修复上游连续/首尾空格导致的空字段崩溃；空字段已忽略。');
  if (ignoredTokens.length) warnings.push(`按上游规则忽略 ${ignoredTokens.length} 个无效 Buff 项；P 必须是大写后缀。`);
  return { buffs, ignoredTokens, warnings };
}

function criticalMultiplier(critical, block, pvp = true) {
  number(critical, '暴击评级', { integer: true });
  number(block, '格挡评级', { integer: true });
  if (typeof pvp !== 'boolean') throw new KimerithInputError('pvp 必须为 true 或 false。');
  if (critical === 0) return 1;
  if (block === 0) return 2;
  const factor = pvp ? 5 : 3;
  const denominator = critical + factor * block;
  if (denominator === 0) throw new KimerithInputError('这组暴击与格挡评级导致分母为零，无法计算。');
  return 2 - ((factor * block) / denominator);
}

function pveDamageCurve(damage) {
  number(damage, 'PvE 曲线输入');
  const value = damage / 100;
  const limit = 2.47, start = 237, offset = 0;
  const limit100 = limit * 100, pivot = start + offset;
  const coefficient = Math.log(limit100 / (limit100 - start)) / start;
  const shift = Math.log(1 - pivot / limit100) + coefficient * pivot;
  if (value > pivot / 100) return 1 + (limit - limit * Math.exp(-100 * coefficient * value + shift));
  return 1 + value;
}

function normalizeAttack(input) {
  const result = {
    base: number(input.base, '基础伤害', { integer: true, min: 0 }),
    damage: number(input.damage ?? 0, '伤害百分比', { integer: true, min: -10000, max: 10000 }),
    pierce: number(input.pierce ?? 0, '穿透百分比', { integer: true, min: -10000, max: 10000 }),
    critical: number(input.critical ?? 0, '暴击评级', { integer: true }),
    pvp: input.pvp ?? true,
    buffs: input.buffs ?? '',
  };
  if (typeof result.pvp !== 'boolean') throw new KimerithInputError('pvp 必须为 true 或 false。');
  return result;
}

function runCalculation(attack, modifiers, block, warnings = [], ignoredTokens = []) {
  let pierce = attack.pierce;
  let damage = truncate(attack.base * (1 + attack.damage / 100));
  const stages = [{ label: `基础 ${attack.base} × (1 + ${attack.damage}%），向零截断`, value: damage, pierce }];
  modifiers.forEach((modifier, index) => {
    if (modifier.isPierce) {
      if (pierce >= -modifier.value) {
        pierce += modifier.value;
      } else {
        const multiplier = pierce / 100 + modifier.modifier;
        pierce = 0;
        damage = truncate(damage * multiplier);
      }
    } else {
      damage = truncate(damage * modifier.modifier);
    }
    stages.push({ label: `${modifier.label || `Buff ${index + 1}`}：${modifier.value}${modifier.isPierce ? 'P' : '%'}；余穿透 ${pierce}`, value: damage, pierce });
  });
  const multiplier = criticalMultiplier(attack.critical, block, attack.pvp);
  const critical = truncate(damage * multiplier);
  stages.push({ label: `${attack.pvp ? 'PvP' : 'PvE'} 暴击倍率 ×${multiplier}，向零截断`, value: critical, pierce });
  if (!attack.pvp) warnings.push('与上游 calc_damage 一致：PvE damage 直接参与计算，没有自动调用 pve_damage_curve；请先确认输入的伤害百分比。');
  if (damage < 0 || critical < 0) warnings.push('输入使上游公式产生负伤害；保留兼容结果，不表示游戏服务器会结算负伤害。');
  return {
    normal: damage, critical, multiplier, remainingPierce: pierce, stages,
    ignoredTokens, warnings: [...new Set(warnings)],
    parameters: { ...attack, block },
    assumptions: [
      '复现 Kimerith-WindHammer 指定提交的单段算法，不等同于已验证的当前游戏服务器机制。',
      'damage/resist 为百分比输入，critical/block 为评级；PvP/PvE 使用上游不同暴击倍率，不计算暴击概率。',
      '按 Buff 输入顺序逐项处理；每次伤害乘法向零截断，保留上游二进制浮点与舍入行为。',
      'P 是大写后缀：正值增加穿透，负值作为可被穿透的减伤；普通负值不会消耗穿透。',
      '不模拟 DoT、多段、吸收、转换、同源叠加合法性、状态消耗或完整战斗流程。',
    ],
    provenance: PROVENANCE,
  };
}

function calculateKimerithDamage(input) {
  validateObject(input, INPUT_KEYS);
  const attack = normalizeAttack(input);
  const resist = number(input.resist ?? 0, '抗性百分比', { integer: true, min: -10000, max: 10000 });
  const block = number(input.block ?? 0, '格挡评级', { integer: true });
  const parsed = translateBuffs(attack.buffs);
  const modifiers = [...parsed.buffs, { ...buff(-resist, true), label: '目标抗性（通用 calc）' }];
  if (resist < 0) parsed.warnings.push('保留上游通用 calc 的负抗性行为：负抗性增加余穿透，不转成易伤；mob calc 的负抗性行为不同。');
  const result = runCalculation(attack, modifiers, block, parsed.warnings, parsed.ignoredTokens);
  result.parameters.resist = resist;
  return result;
}

function validateStats(rows, label) {
  if (!Array.isArray(rows) || rows.length > 512) throw new KimerithInputError(`${label}必须是最多 512 条的属性数组。`);
  return rows.map(row => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new KimerithInputError(`${label}属性记录格式错误。`);
    number(row.order, '属性排序值', { integer: true, min: 0, max: 2e6 });
    number(row.value, '属性值', { min: -Number.MAX_SAFE_INTEGER, max: Number.MAX_SAFE_INTEGER });
    return { ...row };
  });
}

function targetTotals(rows) {
  const targets = {};
  for (const school of SCHOOLS) {
    let resist = 0, block = 0;
    for (const row of rows) {
      if (row.school !== 'universal' && row.school !== school) continue;
      if (row.stat === 'resist') resist += row.value;
      else if (row.stat === 'block') block += row.value;
    }
    if (!Number.isFinite(resist) || !Number.isFinite(block) || Math.abs(resist) > Number.MAX_SAFE_INTEGER || Math.abs(block) > Number.MAX_SAFE_INTEGER) throw new KimerithInputError('合并后的抗性/格挡超过可安全表示的范围。');
    targets[school] = { resist, block };
  }
  return targets;
}

function aggregateMobStats({ baseStats = [], equippedItems = [], objectName = '', duplicateMode = 'upstream', complete = true } = {}) {
  if (!['upstream', 'sum'].includes(duplicateMode)) throw new KimerithInputError('重复属性策略必须是 upstream 或 sum。');
  if (!Array.isArray(equippedItems) || equippedItems.length > 512) throw new KimerithInputError('装备属性组最多 512 组。');
  const base = validateStats(baseStats, '怪物本体').sort((a, b) => a.order - b.order);
  const equipment = equippedItems.map(item => validateStats(Array.isArray(item) ? item : item?.stats, '怪物装备'));
  const warnings = [];
  if (new Set(base.map(row => row.order)).size !== base.length) warnings.push(duplicateMode === 'upstream'
    ? '本体存在同 order 重复记录：兼容上游 sum_stats 的首条写入/末条引用行为，结果不等于简单求和。'
    : '本体存在同 order 重复记录：sum 模式合并求和，明确修复上游重复本体记录覆盖问题。');
  let rows;
  if (duplicateMode === 'sum') {
    const combined = new Map();
    for (const row of [...base, ...equipment.flat()]) {
      if (combined.has(row.order)) combined.get(row.order).value += row.value;
      else combined.set(row.order, { ...row });
    }
    rows = [...combined.values()];
  } else {
    rows = base;
    const latest = new Map(rows.map(row => [row.order, row]));
    for (const stats of equipment) for (const row of stats) {
      const existing = latest.get(row.order);
      if (existing) {
        const index = rows.findIndex(candidate => candidate.order === existing.order);
        rows[index].value = row.value + existing.value;
      } else {
        rows.push(row);
        latest.set(row.order, row);
      }
    }
  }
  rows = validateStats(rows, '合并后').sort((a, b) => a.order - b.order);
  if (rows.some(row => row.order === 2000000)) warnings.push('未知属性沿用上游共同 order=2000000；未知字段不能保证对应当前游戏的完整资料。');
  if (rows.some(row => row.stat === 'resist' && row.unit === 'exported_rating')) warnings.push('上游将 ReduceDamageRating 与 ReduceDamage 一并计入抗性；本模式保留该语义，不宣称这些评级已被官方换算验证。');
  const polymorph = typeof objectName === 'string' && objectName.toLowerCase().includes('polymorph');
  const display = rows.map(row => ({ ...row, value: polymorph ? truncate(row.value / 2) : row.value }));
  if (polymorph) warnings.push('与上游一致：polymorph 怪物详情显示属性减半并向零截断；mob calc 仍使用未减半的本体加装备属性。');
  return { revision: PROVENANCE.revision, stats_scope: 'base_and_equipment', complete: complete === true, duplicate_mode: duplicateMode, raw_stats: rows, display_stats: display, target_by_school: targetTotals(rows), warnings };
}

function calculateKimerithMobDamage(input) {
  validateObject(input, MOB_KEYS);
  const attack = normalizeAttack(input);
  const school = typeof input.school === 'string' ? input.school.toLowerCase() : '';
  if (!SCHOOLS.includes(school)) throw new KimerithInputError('请选择有效攻击学派，例如 fire、ice、storm、myth、life、death、balance。');
  const combat = input.mobCombat;
  if (!combat || combat.stats_scope !== 'base_and_equipment' || combat.complete !== true) throw new KimerithInputError('目标资料尚未完整读取怪物本体与装备属性，不能执行参考模式的 mob calc。');
  if (combat.revision !== PROVENANCE.revision) throw new KimerithInputError('目标战斗资料与本计算器的参考版本不同，请重新导入资料包。');
  const target = combat.target_by_school?.[school];
  if (!target) throw new KimerithInputError('目标资料缺少该攻击学派的抗性与格挡汇总。');
  const resist = number(target.resist, '目标抗性', { integer: true, min: -10000, max: 10000 });
  const block = number(target.block, '目标格挡', { integer: true });
  const parsed = translateBuffs(attack.buffs);
  const modifiers = [...parsed.buffs];
  if (resist < 0) modifiers.push({ ...buff(-resist, false), label: '目标负抗性（易伤）' });
  else if (resist > 0) modifiers.push({ ...buff(-resist, true), label: '目标抗性（mob calc）' });
  const result = runCalculation(attack, modifiers, block, [...parsed.warnings, ...(Array.isArray(combat.warnings) ? combat.warnings.filter(value => typeof value === 'string').slice(0, 20) : [])], parsed.ignoredTokens);
  result.target = { school, resist, block, duplicateMode: combat.duplicate_mode || 'upstream' };
  return result;
}

function formatKimerithReport(result) {
  if (!result || !Number.isSafeInteger(result.normal) || !Number.isSafeInteger(result.critical) || !Array.isArray(result.stages)) throw new KimerithInputError('参考计算结果无效。');
  const display = value => new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 8 }).format(value);
  return [
    '【Kimerith 兼容伤害计算】',
    `非暴击：${display(result.normal)}`, `暴击：${display(result.critical)}`,
    `暴击倍率：${display(result.multiplier)}`,
    ...(result.target ? [`目标：${result.target.school} 抗性 ${result.target.resist}% / 格挡 ${result.target.block}`] : []),
    '', '计算步骤：', ...result.stages.map((row, index) => `${index + 1}. ${row.label} → ${display(row.value)}`),
    ...(result.warnings.length ? ['', '兼容说明：', ...result.warnings.map(value => `• ${value}`)] : []),
    '', ...result.assumptions.map(value => `• ${value}`),
    `参考版本：${PROVENANCE.revision.slice(0, 7)}`,
  ].join('\n');
}

module.exports = { PROVENANCE, SCHOOLS, KimerithInputError, translateBuffs, criticalMultiplier, pveDamageCurve, calculateKimerithDamage, calculateKimerithMobDamage, aggregateMobStats, formatKimerithReport };
