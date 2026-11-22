'use strict';

const fs = require('node:fs/promises');
const zlib = require('node:zlib');
const { parseJsonLossless, normalizeId, entityName } = require('./api.cjs');
const OpenCC = require('opencc-js');

const simplify = OpenCC.Converter({ from: 'tw', to: 'cn' });
const CATALOG_TYPES = Object.freeze(['item', 'spell', 'mob', 'pet', 'fish', 'statcaps', 'zone', 'npc', 'quest', 'talent', 'event', 'recipe']);
const LOCAL_ONLY = new Set(['pet', 'fish', 'statcaps']);
const ALIASES = { gear: 'item', equipment: 'item', items: 'item', 装备: 'item', 物品: 'item', spells: 'spell', 法术: 'spell', 法術: 'spell', mobs: 'mob', boss: 'mob', 怪物: 'mob', pets: 'pet', 宠物: 'pet', 寵物: 'pet', fishes: 'fish', 鱼类: 'fish', 魚類: 'fish', caps: 'statcaps', 上限: 'statcaps', 区域: 'zone', 區域: 'zone', 人物: 'npc', 任务: 'quest', 任務: 'quest', 天赋: 'talent', 天賦: 'talent', 活动: 'event', 活動: 'event', 配方: 'recipe' };
const SCHOOLS = Object.freeze({ fire: '火焰', ice: '寒冰', storm: '风暴', myth: '神话', life: '生命', death: '死亡', balance: '平衡', sun: '太阳', moon: '月亮', star: '星辰', shadow: '暗影', universal: '通用', gardening: '园艺', fishing: '钓鱼', cantrips: '戏法', castlemagic: '城堡魔法', whirlyburly: '旋转棋' });
const SCHOOL_ALIASES = { 火: 'fire', 火焰: 'fire', 冰: 'ice', 寒冰: 'ice', 风: 'storm', 风暴: 'storm', 神话: 'myth', 生命: 'life', 生: 'life', 死亡: 'death', 死: 'death', 平衡: 'balance', 太阳: 'sun', 月亮: 'moon', 星辰: 'star', 暗影: 'shadow', 通用: 'universal', 全系: 'universal', any: '', all: '', 全部: '' };
const KIND_ALIASES = { 帽子: 'hat', 帽: 'hat', 长袍: 'robe', 衣服: 'robe', 靴子: 'shoes', 鞋: 'shoes', boots: 'shoes', 法杖: 'weapon', wand: 'weapon', 短剑: 'athame', 护符: 'amulet', 戒指: 'ring', 牌组: 'deck', 宝石: 'jewel', 坐骑: 'mount' };

function normalize(value) {
  return simplify(String(value ?? '').normalize('NFKC')).toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim();
}

function catalogType(input) {
  const key = normalize(input);
  const type = Object.hasOwn(ALIASES, key) ? ALIASES[key] : key;
  if (!CATALOG_TYPES.includes(type)) throw new Error('查询类别无效。可选 item、spell、mob、pet、fish、statcaps、zone、npc、quest、talent、event、recipe。');
  return type;
}

function schoolName(value, { allowUnknown = false } = {}) {
  const key = normalize(value);
  const school = Object.hasOwn(SCHOOL_ALIASES, key) ? SCHOOL_ALIASES[key] : key;
  if (!school || Object.hasOwn(SCHOOLS, school)) return school;
  if (allowUnknown) return key;
  throw new Error('查询学派无效，请输入 fire、ice、storm、myth、life、death、balance 等英文或中文学派名。');
}

function kindName(value) {
  const key = normalize(value);
  return Object.hasOwn(KIND_ALIASES, key) ? KIND_ALIASES[key] : key;
}

function normalizeFilters(input = {}) {
  const out = {};
  if (input.school !== undefined && input.school !== '') out.school = schoolName(input.school);
  if (input.kind !== undefined && input.kind !== '') {
    out.kind = kindName(input.kind);
    if (out.kind.length > 60) throw new Error('查询类型筛选过长。');
  }
  for (const key of ['level', 'rank', 'wow']) {
    if (input[key] === undefined || input[key] === '') continue;
    const value = Number(input[key]);
    if (!Number.isFinite(value) || value < 0 || value > 10000) throw new Error(`查询 ${key} 筛选必须为 0–10000 的有限数字。`);
    out[key] = value;
  }
  for (const key of ['exclusive', 'sentinel']) {
    if (input[key] === undefined || input[key] === '') continue;
    const value = input[key];
    if ([true, 1, '1', 'true', 'yes', '是'].includes(value)) out[key] = true;
    else if ([false, 0, '0', 'false', 'no', '否'].includes(value)) out[key] = false;
    else throw new Error(`查询 ${key} 筛选应为 true 或 false。`);
  }
  if (input.object) out.object = true;
  return out;
}

function cleanEntry(raw, index) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`资料包第 ${index + 1} 条不是对象。`);
  const type = catalogType(raw.type);
  const id = normalizeId(raw.id ?? raw.template_id);
  const name = entityName(raw);
  if (!name || name.length > 400) throw new Error(`资料包第 ${index + 1} 条缺少有效名称。`);
  let nodes = 0;
  function inspect(value, depth) {
    if (++nodes > 4096 || depth > 10) throw new Error('资料包字段嵌套过深或过多。');
    if (typeof value === 'string' && value.length > 16000) throw new Error('资料包字段文字过长。');
    if (typeof value === 'number' && (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value)))) throw new Error('资料包含无效或精度已丢失的数值。ID 请使用字符串。');
    if (Array.isArray(value) && value.length > 512) throw new Error('资料包单字段数组过长。');
    if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('资料包含不允许的字段。');
      inspect(child, depth + 1);
    }
  }
  inspect(raw, 0);
  return { ...raw, type, id, template_id: id, name };
}

function validSource(source = {}) {
  const result = { name: String(source.name || '本地资料包').slice(0, 160), version: String(source.version || '').slice(0, 100), synthetic: source.synthetic === true };
  if (typeof source.url === 'string') {
    try {
      const url = new URL(source.url);
      if (url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash) result.url = url.href.slice(0, 500);
    } catch (_) { /* A local pack does not require a public source URL. */ }
  }
  if (typeof source.generatedAt === 'string' && Number.isFinite(Date.parse(source.generatedAt))) result.generatedAt = source.generatedAt;
  return result;
}

class LocalCatalog {
  constructor(document = { kind: 'wizard101.catalog', schemaVersion: 1, entries: [] }) {
    if (document?.kind !== 'wizard101.catalog' || document.schemaVersion !== 1 || !Array.isArray(document.entries)) throw new Error('资料包需要 kind=wizard101.catalog、schemaVersion=1 和 entries 数组。');
    if (document.entries.length > 100000) throw new Error('资料包超过 100000 条上限。');
    this.source = validSource(document.source);
    this.byType = new Map();
    this.byId = new Map();
    this.closed = false;
    document.entries.forEach((raw, i) => {
      const entry = cleanEntry(raw, i);
      const key = `${entry.type}:${entry.id}`;
      if (this.byId.has(key)) throw new Error(`资料包存在重复类型与 ID：${key}`);
      this.byId.set(key, entry);
      if (!this.byType.has(entry.type)) this.byType.set(entry.type, []);
      this.byType.get(entry.type).push({ entry, names: [...new Set([entry.name, entry.zh, entry.name_zh, ...(Array.isArray(entry.aliases) ? entry.aliases : [])].filter(v => typeof v === 'string').map(normalize))], object: normalize(entry.object_name ?? entry.real_name), school: schoolName(entry.school ?? entry.school_name ?? entry.equip_school, { allowUnknown: true }), kind: kindName(entry.kind ?? entry.slot ?? entry.item_type ?? entry.category) });
    });
  }

  static async load(filename) {
    const stat = await fs.stat(filename);
    if (!stat.isFile() || stat.size > 64 * 1024 * 1024) throw new Error('资料包文件过大。');
    let buffer = await fs.readFile(filename);
    if (buffer[0] === 0x1f && buffer[1] === 0x8b) buffer = zlib.gunzipSync(buffer, { maxOutputLength: 64 * 1024 * 1024 });
    return new LocalCatalog(parseJsonLossless(buffer.toString('utf8')));
  }

  stats() { return { entries: this.byId.size, types: Object.fromEntries([...this.byType].map(([type, rows]) => [type, rows.length])), source: this.source }; }
  has(type) { return !!this.byType.get(catalogType(type))?.length; }
  get(type, id) { return this.byId.get(`${catalogType(type)}:${normalizeId(id)}`) || null; }
  lookupObject(type, value) {
    return (this.byType.get(catalogType(type)) || []).filter(row => String(row.entry.object_name ?? row.entry.real_name ?? '') === value).map(row => row.entry);
  }

  search(typeInput, queries = [], inputFilters = {}, page = 1, pageSize = 8) {
    const type = catalogType(typeInput);
    const filters = normalizeFilters(inputFilters);
    if (!Number.isSafeInteger(page) || page < 1 || page > 100000) throw new Error('查询页码必须是正整数。');
    if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 20) throw new Error('查询每页条数必须在 1–20 之间。');
    const needles = [...new Set((Array.isArray(queries) ? queries : [queries]).map(normalize).filter(Boolean))];
    if (needles.length > 20 || needles.some(q => q.length > 400)) throw new Error('查询条件过多或过长。');
    const matches = [];
    for (const row of this.byType.get(type) || []) {
      const e = row.entry;
      if (filters.school && row.school !== filters.school) continue;
      if (filters.kind && row.kind !== filters.kind) continue;
      const level = e.level ?? e.required_level ?? e.equip_level;
      if (filters.level !== undefined && (level === null || level === undefined || Number(level) !== filters.level)) continue;
      if (filters.rank !== undefined && (e.rank === null || e.rank === undefined || Number(e.rank) !== filters.rank)) continue;
      if (filters.wow !== undefined && (e.wow_factor === null || e.wow_factor === undefined || Number(e.wow_factor) !== filters.wow)) continue;
      if (filters.exclusive !== undefined && ![filters.exclusive, Number(filters.exclusive)].includes(e.exclusive)) continue;
      if (filters.sentinel !== undefined && ![filters.sentinel, Number(filters.sentinel)].includes(e.is_sentinel)) continue;
      const names = filters.object ? [row.object] : row.names;
      const exact = needles.some(q => names.includes(q) || e.id === q);
      if (needles.length && !exact && !needles.some(q => names.some(n => n.includes(q)))) continue;
      matches.push({ e, exact });
    }
    matches.sort((a, b) => Number(b.exact) - Number(a.exact) || a.e.name.localeCompare(b.e.name, 'en') || a.e.id.localeCompare(b.e.id));
    const total = matches.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    return { items: matches.slice((page - 1) * pageSize, page * pageSize).map(v => v.e), total, totalPages, page, nextPage: page < totalPages ? page + 1 : null, exactUnique: total === 1 && matches[0].exact, filters };
  }

  levels(school) {
    const wanted = schoolName(school);
    return [...new Set((this.byType.get('statcaps') || []).filter(v => v.school === wanted).map(v => Number(v.entry.level)).filter(Number.isFinite))].sort((a, b) => a - b);
  }

  dispose() { this.closed = true; this.byId.clear(); this.byType.clear(); }
}

module.exports = { LocalCatalog, CATALOG_TYPES, LOCAL_ONLY, SCHOOLS, catalogType, schoolName, kindName, normalize, normalizeFilters };
