'use strict';

const { entityName, entityId } = require('./api.cjs');

const LABELS = Object.freeze({ item: '物品', spell: '法术', mob: '怪物', zone: '区域', npc: 'NPC', quest: '任务', talent: '天赋', event: '活动', recipe: '配方' });
const FIELD_LABELS = Object.freeze({
  name: '名称', display_name: '显示名称', description: '说明', school: '学派', school_name: '学派', rank: '阶级', level: '等级', required_level: '需求等级',
  health: '生命值', max_health: '生命值上限', hp: '生命值', mana: '法力', pips: '魔豆', pip_cost: '魔豆消耗', power_pips: '超级魔豆', shadow_pips: '暗影魔豆',
  accuracy: '命中', damage: '伤害', resist: '抗性', resistance: '抗性', boost: '易伤', critical: '暴击', critical_block: '暴击抵挡', pierce: '穿透',
  healing: '治疗', outgoing_healing: '对外治疗', incoming_healing: '接受治疗', stats: '属性', computed_stats: '计算后属性', combat_stats: '战斗属性',
  type: '类型', item_type: '物品类型', category: '类别', slot: '部位', rarity: '稀有度', school_restriction: '学派限制',
  location: '位置', locations: '位置', zone: '区域', zones: '区域', world: '世界', worlds: '世界', connections: '连接区域',
  spells: '法术', cards: '卡牌', talents: '天赋', sockets: '插槽', jewels: '宝石', set_bonus: '套装效果',
  ingredients: '材料', reagents: '材料', quantity: '数量', count: '数量', amount: '数量', cost: '费用', gold: '金币', price: '价格',
  rewards: '奖励', objectives: '目标', prerequisites: '前置条件', prerequisite_quests: '前置任务', next_quests: '后续任务',
  start_npc: '接取 NPC', end_npc: '交付 NPC', vendors: '商人', vendor: '商人', inventory: '商品',
  template_id: '条目 ID', id: 'ID', object_name: '内部路径', parsed_data: '游戏数据',
  loot_entries: '掉落条目', direct_drops: '直接掉落', currencies: '货币', source_owners: '关联来源',
  loot_table_groups: '掉落表', second_chance_chests: '二次机会宝箱', pooled_minions: '关联随从',
  pooled_polymorphs: '关联变身', linked_chests: '关联宝箱', is_resolved: '是否已解析',
});
const SKIP = /^(?:html|rendered_html|cheats_html|raw_data|binary|texture|nif|icon|image|image_url|icon_url|thumbnail|model|mesh|vertices|token|api_key|authorization|cookie|password|secret)$/i;
const SCHOOL_LABELS = { fire: '火焰', ice: '寒冰', storm: '风暴', myth: '神话', life: '生命', death: '死亡', balance: '平衡', sun: '太阳', moon: '月亮', star: '星辰', shadow: '暗影', universal: '通用' };

function clip(value, limit = 200) {
  const text = String(value ?? '').replace(/\r/g, '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
  return text.length <= limit ? text : text.slice(0, limit - 1) + '…';
}

function cleanText(value, limit = 1200) {
  return clip(String(value ?? '').replace(/<!--[^]*?-->/g, '').replace(/<\/?(?:b|i|u|p|br|span|div|strong|em|font)(?:\s[^>]*?)?\s*\/?\s*>/gi, ' ').replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2').trim(), limit);
}

function label(key) { return FIELD_LABELS[key] || key; }

function bilingual(english, dict, ref) {
  const en = cleanText(english, 180);
  if (!en) return '未命名条目';
  const result = dict.translate(en, ref);
  if (result.translated && result.text !== en) return `${cleanText(result.text, 140)} / ${en}`;
  return en;
}

function referenceOf(entity) {
  const value = entity?.name_ref || entity?.display_name_ref || entity?.name_key || entity?.display_name_key;
  return typeof value === 'string' ? value : undefined;
}

function sourceUrl(type, id) {
  if (!LABELS[type] || !/^\d{1,40}$/.test(String(id))) return '';
  return `https://wizard404.com/${type}/${id}`;
}

function footer(type, id, result) {
  const time = Number.isFinite(result?.fetchedAt) ? new Date(result.fetchedAt).toISOString().replace('T', ' ').slice(0, 19) + ' UTC' : '本次查询';
  return `\n来源：Wizard404${result?.cacheHit ? '（缓存）' : ''} · ${time}\n${sourceUrl(type, id)}`;
}

function bounded(body, tail, max = 3500) {
  return clip(body, Math.max(200, max - tail.length)) + tail;
}

function dictionary(query, result, page, pageSize, prefix, note = '') {
  const lines = [`【中英词典】${clip(query, 80)}`, `共 ${result.total} 条匹配 · 第 ${page} 页${result.exact ? ' · 精确匹配优先' : ''}`];
  result.rows.forEach((row, i) => {
    lines.push(`${i + 1}. ${cleanText(row.zh || '（无译文）', 120)}\n   ${cleanText(row.en || '（原文为空）', 150)}\n   ${clip(row.ref || `${row.file}:${row.key}`, 180)}`);
  });
  if (!result.rows.length) lines.push('汉化词典中未找到匹配。可尝试英文名、短一些的关键词，或配置常用别名。');
  if (result.rows.length) lines.push(`查看完整文本：${prefix}.pick 1`);
  if (page * pageSize < result.total) lines.push(`下一页：${prefix}.next`);
  if (note) lines.push(note);
  return bounded(lines.join('\n'), '\n来源：你提供的中文本地化包', 3500);
}

function dictionaryEntry(row) {
  return bounded(`【本地化条目】\n中文：${cleanText(row.zh || '（无译文）', 1500)}\n英文：${cleanText(row.en || '（原文为空）', 1500)}`, `\n引用：${clip(row.ref || `${row.file}:${row.key}`, 240)}\n来源：你提供的中文本地化包`, 3500);
}

function choices(query, terms, type, prefix) {
  const lines = [`“${clip(query, 100)}”对应多个英文名称，请先选择：`];
  terms.forEach((term, i) => lines.push(`${i + 1}. ${clip(term, 180)}`));
  lines.push(`查询类别：${LABELS[type]}\n发送 ${prefix}.pick 1 选择。也可直接输入英文全名。`);
  return lines.join('\n');
}

function searchResults(query, english, type, items, list, page, prefix, dict, result, rejected = 0) {
  const lines = [`【${LABELS[type]}搜索】${clip(query, 80)}${query !== english ? ` → ${clip(english, 100)}` : ''}`, `第 ${page} 页 · 本页 ${items.length} 项`];
  items.forEach((item, index) => lines.push(`${index + 1}. ${bilingual(entityName(item), dict, referenceOf(item))}\n   ID：${entityId(item)}`));
  if (!items.length) lines.push('本页没有名称匹配的条目。API 搜索参数或数据覆盖仍需核实；这不表示游戏中不存在。');
  if (items.length) lines.push(`详情：${prefix}.pick 1`);
  if (list.nextPage !== null && list.nextPage > page) lines.push(`下一页：${prefix}.next`);
  if (rejected) lines.push(`已排除 ${rejected} 条名称不符或缺少有效 ID 的记录。`);
  return bounded(lines.join('\n'), `\n来源：Wizard404${result.cacheHit ? '（缓存）' : ''} · 在线按名搜索为待联调功能`, 3500);
}

function primitive(value, key, dict) {
  if (value === null) return '未提供';
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (typeof value === 'number') return String(value);
  const text = cleanText(value, 280);
  if (/school/.test(key) && SCHOOL_LABELS[text.toLowerCase()]) return `${SCHOOL_LABELS[text.toLowerCase()]} (${text})`;
  if (/name|description|objective|location|world/.test(key)) return bilingual(text, dict);
  return text;
}

function flattenFields(value, dict, { maxLines = 35, maxDepth = 4, skipName = true } = {}) {
  const lines = [];
  let omitted = 0;
  function walk(node, path, depth, rawKey = '') {
    if (lines.length >= maxLines) { omitted++; return; }
    if (node === null || typeof node !== 'object') {
      if (node !== undefined && String(node).length) lines.push(`${path || '值'}：${primitive(node, rawKey, dict)}`);
      return;
    }
    if (depth > maxDepth) { omitted++; return; }
    if (Array.isArray(node)) {
      if (!node.length) { lines.push(`${path}：未提供条目`); return; }
      const named = node.every(v => v && typeof v === 'object' && entityName(v));
      if (named) {
        const values = node.slice(0, 6).map(v => `${bilingual(entityName(v), dict, referenceOf(v))}${entityId(v) ? `〔${entityId(v)}〕` : ''}`);
        lines.push(`${path}：${values.join('；')}${node.length > 6 ? `；另 ${node.length - 6} 项` : ''}`);
      } else node.slice(0, 6).forEach((v, i) => walk(v, `${path}[${i + 1}]`, depth + 1, rawKey));
      if (!named && node.length > 6) omitted += node.length - 6;
      return;
    }
    for (const [key, child] of Object.entries(node)) {
      if (SKIP.test(key) || /^_/.test(key)) continue;
      if (skipName && depth === 0 && ['name', 'display_name', 'template_id', 'id'].includes(key)) continue;
      if (['drops', 'cheats', 'deck'].includes(key) && depth === 0) continue;
      walk(child, path ? `${path} / ${label(key)}` : label(key), depth + 1, key);
    }
  }
  walk(value, '', 0);
  if (omitted) lines.push('更多字段请查看来源页面。');
  return lines;
}

function detail(type, id, entity, result, dict, prefix) {
  const name = entityName(entity);
  const translated = dict.translate(name, referenceOf(entity));
  const lines = [`【${LABELS[type]}】${bilingual(name, dict, referenceOf(entity))}`, `ID：${id}`];
  if (translated.ambiguous) lines.push(`同名译文有歧义：${translated.candidates.slice(0, 4).map(v => clip(v, 60)).join(' / ')}。本条保留英文名。`);
  lines.push(...flattenFields(entity, dict));
  if (lines.length <= 2) lines.push('接口未提供更多可显示字段。');
  if (type === 'mob') lines.push(`继续查询：${prefix}.drops ${id} / ${prefix}.cheats ${id} / ${prefix}.deck ${id}`);
  return bounded(lines.join('\n'), footer(type, id, result));
}

function relation(id, relationType, data, result, dict) {
  const title = { drops: '掉落', cheats: '特殊机制', deck: '牌库' }[relationType];
  const lines = [`【怪物${title}】ID ${id}`];
  let payload = data?.[relationType] ?? data;
  if (relationType === 'cheats') {
    const markdown = typeof payload === 'string' ? payload : payload?.markdown ?? payload?.cheats_markdown ?? payload?.effective_markdown ?? payload?.text;
    if (typeof markdown === 'string' && markdown.trim()) lines.push('机制原文（尚未进行人工中文翻译）：', cleanText(markdown, 2700));
    else if (payload && typeof payload === 'object') {
      const fields = flattenFields(payload, dict, { maxLines: 20, skipName: false });
      lines.push(fields.length ? fields.join('\n') : '来源尚未收录可读的机制说明；不代表此怪物没有特殊机制。');
    } else lines.push('来源尚未收录可读的机制说明；不代表此怪物没有特殊机制。');
  } else if (relationType === 'drops') {
    const groups = payload?.loot_table_groups;
    if (Array.isArray(groups)) {
      const unresolved = groups.filter(group => group?.is_resolved === false).length;
      if (unresolved) lines.push(`有 ${unresolved} 张掉落表尚未解析。`);
    }
    const fields = flattenFields(payload, dict, { maxLines: 28, skipName: false });
    lines.push(...fields);
    lines.push('空列表表示尚无已知记录。未给出概率的掉落不会推算概率；宝箱和关联来源按返回分组保留。');
  } else {
    const cards = Array.isArray(payload) ? payload : payload?.cards ?? payload?.spells ?? payload?.deck;
    if (Array.isArray(cards)) {
      cards.slice(0, 20).forEach((card, i) => lines.push(`${i + 1}. ${bilingual(entityName(card), dict, referenceOf(card))} × ${card.count ?? '未提供张数'}${entityId(card) ? `〔${entityId(card)}〕` : ''}`));
      if (!cards.length) lines.push('来源尚未收录可抽取卡牌。');
      if (cards.length > 20) lines.push(`另有 ${cards.length - 20} 项，详见来源。`);
    } else lines.push(...flattenFields(payload, dict, { maxLines: 25, skipName: false }));
  }
  return bounded(lines.join('\n'), footer('mob', id, result));
}

function numericStats(entity) {
  const out = new Map();
  const roots = ['stats', 'computed_stats', 'combat_stats'];
  const root = roots.find(key => entity?.[key] && typeof entity[key] === 'object');
  const value = root ? entity[root] : entity?.parsed_data?.stats;
  if (!value) return out;
  function walk(node, path, depth) {
    if (depth > 6 || out.size >= 100) return;
    if (typeof node === 'number' && Number.isFinite(node)) { out.set(path, node); return; }
    if (node && typeof node === 'object' && !Array.isArray(node)) {
      for (const [key, child] of Object.entries(node)) {
        if (!/id|version|time|level|rank/i.test(key)) walk(child, path ? `${path}.${key}` : key, depth + 1);
      }
    }
  }
  walk(value, '', 0);
  return out;
}

function compare(leftId, left, rightId, right, dict) {
  const lines = ['【物品属性对比】', `A：${bilingual(entityName(left), dict)}〔${leftId}〕`, `B：${bilingual(entityName(right), dict)}〔${rightId}〕`];
  const a = numericStats(left), b = numericStats(right);
  const common = [...a.keys()].filter(key => b.has(key));
  if (!common.length) lines.push('两条记录没有同路径的可比数值属性；不把缺失值当作 0。请分别查看物品详情。');
  for (const key of common.slice(0, 24)) {
    const diff = Number((b.get(key) - a.get(key)).toPrecision(12));
    lines.push(`${key}：${a.get(key)} → ${b.get(key)}（B−A ${diff >= 0 ? '+' : ''}${diff}）`);
  }
  if (common.length > 24) lines.push(`其余 ${common.length - 24} 项见原始详情。`);
  if (common.length) lines.push('按相同原始属性字段比较；未换算评级、叠加通用加成或判断配装强弱。');
  return bounded(lines.join('\n'), `\n来源：Wizard404\n${sourceUrl('item', leftId)}\n${sourceUrl('item', rightId)}`);
}

module.exports = { LABELS, FIELD_LABELS, SCHOOL_LABELS, clip, cleanText, bilingual, sourceUrl, bounded, dictionary, dictionaryEntry, choices, searchResults, detail, relation, compare, numericStats, flattenFields };
