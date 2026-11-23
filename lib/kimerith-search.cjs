'use strict';

// Query behavior compatible with Kimerith-WindHammer 3c24847d, with Unicode
// normalization and Chinese names added. See LICENSE and THIRD_PARTY_NOTICES.
const { normalize, schoolName, kindName, catalogType } = require('./catalog.cjs');
const { normalizeId } = require('./api.cjs');

function bool(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if ([true, 1, '1', 'true', 'yes', '是', '开启'].includes(value)) return true;
  if ([false, 0, '0', 'false', 'no', '否', '关闭'].includes(value)) return false;
  throw new Error('查询布尔参数必须是 true 或 false。');
}

function ratio(a, b) {
  a = Array.from(a); b = Array.from(b);
  if (!a.length && !b.length) return 100;
  const positions = new Map();
  b.forEach((ch, i) => { if (!positions.has(ch)) positions.set(ch, []); positions.get(ch).push(i); });
  if (b.length >= 200) for (const [ch, indexes] of positions) if (indexes.length > Math.floor(b.length / 100) + 1) positions.delete(ch);
  const queue = [[0, a.length, 0, b.length]], blocks = [];
  while (queue.length) {
    const [alo, ahi, blo, bhi] = queue.pop();
    let bestA = alo, bestB = blo, size = 0, previous = new Map();
    for (let i = alo; i < ahi; i++) {
      const next = new Map();
      for (const j of positions.get(a[i]) || []) {
        if (j < blo) continue;
        if (j >= bhi) break;
        const n = (previous.get(j - 1) || 0) + 1;
        next.set(j, n);
        if (n > size) { bestA = i - n + 1; bestB = j - n + 1; size = n; }
      }
      previous = next;
    }
    while (bestA > alo && bestB > blo && a[bestA - 1] === b[bestB - 1]) { bestA--; bestB--; size++; }
    while (bestA + size < ahi && bestB + size < bhi && a[bestA + size] === b[bestB + size]) size++;
    if (!size) continue;
    blocks.push(size);
    if (alo < bestA && blo < bestB) queue.push([alo, bestA, blo, bestB]);
    if (bestA + size < ahi && bestB + size < bhi) queue.push([bestA + size, ahi, bestB + size, bhi]);
  }
  return Math.round(200 * blocks.reduce((sum, n) => sum + n, 0) / (a.length + b.length));
}

function tokenSetRatio(left, right) {
  const tokens = value => new Set(normalize(value).replace(/[^\p{L}\p{N}_]+/gu, ' ').trim().split(/\s+/).filter(Boolean));
  const a = tokens(left), b = tokens(right);
  if (!a.size || !b.size) return 0;
  const common = [...a].filter(v => b.has(v)).sort().join(' ');
  const aa = [common, [...a].filter(v => !b.has(v)).sort().join(' ')].filter(Boolean).join(' ');
  const bb = [common, [...b].filter(v => !a.has(v)).sort().join(' ')].filter(Boolean).join(' ');
  return Math.max(ratio(common, aa), ratio(common, bb), ratio(aa, bb));
}
function fuzzyScore(left, right) { return tokenSetRatio(left, right) + ratio(normalize(left), normalize(right)); }

const FILTER_KINDS = { 简单: 'easy', 普通: 'normal', 精英: 'elite', 首领: 'boss', 头目: 'boss', 治疗: 'healing', 伤害: 'damage', 刃: 'charm', 盾: 'ward', 光环: 'aura', 全场: 'global', 群攻: 'aoe', 窃取: 'steal', 操控: 'manipulation', 附魔: 'enchantment', 变形: 'polymorph', 虚弱: 'curse', 陷阱: 'jinx', 变异: 'mutate', 隐匿: 'cloak' };
Object.assign(FILTER_KINDS, { 挂饰: 'charm', 增益挂饰: 'charm', 防护挂饰: 'ward', 护盾: 'ward', 全场结界: 'global', 全局: 'global', 群体攻击: 'aoe', 群体: 'aoe', 偷取: 'steal', 变身: 'polymorph', 负面挂饰: 'curse', 诅咒: 'curse', 厄运: 'jinx', 隐蔽: 'cloak', 暗影: 'shadow', 暗影生物: 'shadow_creature', 暗影自身: 'shadow_self', 负面光环: 'aura_negative' });
const SPECIAL_KINDS = { gardening: { 生长: 'unknown', 除虫: 'healing', 土壤: 'damage', 园艺辅助: 'charm', 保护: 'ward' }, fishing: { 捕捉: 'unknown', 钓鱼辅助: 'healing' }, cantrips: { 咒语: 'unknown', 增益: 'healing', 符印: 'damage', 传送: 'charm', 仪式: 'ward' } };
function parseFilters(params) {
  const school = schoolName(params.school || 'Any');
  let kind = normalize(params.kind || 'Any');
  if (['any', '全部', '*'].includes(kind)) kind = '';
  kind = SPECIAL_KINDS[school]?.[kind] || FILTER_KINDS[kind] || kindName(kind);
  const filters = { school, kind, exclusive: bool(params.exclusive), sentinel: bool(params.is_sentinel ?? params.sentinel) };
  for (const key of ['level', 'rank', 'wow']) {
    if (params[key] === undefined || params[key] === null || params[key] === '' || Number(params[key]) === -1) continue;
    const n = Number(params[key]);
    if (!Number.isSafeInteger(n) || n < 0 || n > 10000) throw new Error(`查询 ${key} 必须是 -1 或 0–10000 的整数。`);
    filters[key] = n;
  }
  return filters;
}

class KimerithSearch {
  constructor(catalog, dict) { this.catalog = catalog; this.dict = dict; this.names = new WeakMap(); }
  namesOf(row) {
    if (!this.names.has(row)) {
      const names = [...row.names];
      const translated = this.dict.translate(row.entry.name, row.entry.name_ref)?.text;
      if (translated) names.push(normalize(translated));
      this.names.set(row, [...new Set(names)]);
    }
    return this.names.get(row);
  }
  eligible(type, params) {
    const f = parseFilters(params);
    return (this.catalog.byType.get(catalogType(type)) || []).filter(row => {
      const e = row.entry;
      if (f.school && row.school !== f.school) return false;
      if (f.kind && row.kind !== f.kind) return false;
      const level = e.level ?? e.required_level ?? e.equip_level;
      if (f.level !== undefined && (level == null || Number(level) !== f.level)) return false;
      if (f.rank !== undefined && (e.rank == null || Number(e.rank) !== f.rank)) return false;
      if (f.wow !== undefined && (e.wow_factor == null || Number(e.wow_factor) !== f.wow)) return false;
      if (f.exclusive !== undefined && ![f.exclusive, Number(f.exclusive)].includes(e.exclusive)) return false;
      if (f.sentinel !== undefined && ![f.sentinel, Number(f.sentinel)].includes(e.is_sentinel)) return false;
      return true;
    });
  }
  find(type, params = {}) {
    const raw = String(params.name ?? '').normalize('NFKC').trim();
    if (!raw || raw.length > 400) throw new Error('查询名称需要 1–400 个字符。');
    const mode = normalize(params.search_by || 'Name');
    if (!['name', '名称', 'object', '内部名', 'id'].includes(mode)) throw new Error('查询 search_by 应为 Name、Object 或 ID。');
    const all = this.catalog.byType.get(catalogType(type)) || [];
    if (mode === 'id') {
      const entry = this.catalog.get(type, normalizeId(raw));
      return { items: entry ? [entry] : [], exact: true, query: raw };
    }
    if (['object', '内部名'].includes(mode)) return { items: all.filter(r => r.object === normalize(raw)).map(r => r.entry), exact: true, query: raw };
    const rows = this.eligible(type, params);
    const resolved = this.dict.resolve(raw, { limit: 10 });
    const terms = [...new Set([raw, ...(resolved.queries || [])].map(normalize))];
    const exact = rows.filter(r => this.namesOf(r).some(name => terms.includes(name)));
    if (exact.length || !rows.length) return { items: exact.map(r => r.entry), exact: true, query: raw };
    let winner = null, score = -1;
    for (const row of rows) {
      const value = Math.max(...this.namesOf(row).flatMap(name => terms.map(term => fuzzyScore(term, name))));
      if (value > score) { winner = row; score = value; }
    }
    const sameName = normalize(winner.entry.name);
    return { items: rows.filter(r => normalize(r.entry.name) === sameName).map(r => r.entry), exact: false, query: raw, matched: winner.entry.name, score };
  }
  list(type, params = {}) {
    const raw = String(params.name ?? '*').normalize('NFKC').trim();
    if (!raw || raw.length > 400) throw new Error('查询名称需要 1–400 个字符，可用 * 列出全部。');
    const object = bool(params.use_object_name ?? params.object, false);
    const terms = raw === '*' ? [] : [...new Set([raw, ...(this.dict.resolve(raw, { limit: 10 }).queries || [])].map(normalize))];
    const rows = this.eligible(type, params).filter(row => !terms.length || terms.some(t => (object ? [row.object] : this.namesOf(row)).some(n => n.includes(t))));
    const unique = new Map();
    for (const row of rows) {
      const key = object ? row.object : normalize(row.entry.name);
      if (!unique.has(key)) unique.set(key, row.entry);
    }
    const items = [...unique.values()].sort((a, b) => String(object ? a.object_name : a.name).localeCompare(String(object ? b.object_name : b.name), 'en'));
    return { items, object, query: raw, total: items.length };
  }
}

module.exports = { KimerithSearch, parseFilters, bool, ratio, tokenSetRatio, fuzzyScore };
